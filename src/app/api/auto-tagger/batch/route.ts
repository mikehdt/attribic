/**
 * API Route: POST /api/auto-tagger/batch
 * Tag multiple images with streaming progress updates via SSE
 */

import fs from 'fs';
import { NextRequest } from 'next/server';
import path from 'path';

import { isSupportedVideoExtension } from '@/app/constants';
import type {
  TaggerOptions,
  TaggingSseEvent,
  TagResult,
  VlmOptions,
} from '@/app/services/auto-tagger';
import {
  DEFAULT_TAGGER_OPTIONS,
  DEFAULT_VLM_OPTIONS,
  getModel,
  getProviderTypeForModel,
} from '@/app/services/auto-tagger';
import { displayName } from '@/app/services/auto-tagger/display-name';
import { checkModelStatus } from '@/app/services/auto-tagger/model-manager';
import type { CaptionBatchItem } from '@/app/services/auto-tagger/providers/vlm/client';
import { captionBatchViaSidecar } from '@/app/services/auto-tagger/providers/vlm/client';
import { translateVlmBatchEvents } from '@/app/services/auto-tagger/providers/vlm/sse-translate';
import {
  appendOnnxResult,
  createOnnxBatch,
  finishOnnxBatch,
  isOnnxCancelRequested,
} from '@/app/services/auto-tagger/providers/wd14/batch-store';
import { tagImageInWorker } from '@/app/services/auto-tagger/providers/wd14/worker-manager';
import { getProjectsFolder } from '@/app/services/config/server-config';
import { ensureVideoPoster } from '@/app/utils/asset-actions';

const getServerConfig = () => ({
  projectsFolder: getProjectsFolder() || 'public/assets',
});

type BatchTagRequest = {
  modelId: string;
  projectPath: string;
  /**
   * Client-supplied batch/job ID. Doubles as the sidecar batch_id so the
   * client can cancel (POST /batch/cancel) or reattach (GET /batch/attach)
   * using the same identifier it already tracks in its jobs store.
   */
  batchId?: string;
  /** Project folder name, used to find this project's batches on reattach. */
  projectFolderName?: string;
  assets: { fileId: string; fileExtension: string }[];
  /** ONNX (WD14) options — threshold, includeCharacterTags, etc. */
  options?: Partial<TaggerOptions>;
  /** VLM (NL captioner) options — prompt, temperature, max tokens */
  vlmOptions?: Partial<VlmOptions>;
  /**
   * Project trigger phrases — injected into the VLM prompt when
   * `vlmOptions.injectTriggerPhrases` is true. Ignored by ONNX batches.
   */
  triggerPhrases?: string[];
};

export async function POST(request: NextRequest) {
  try {
    const body: BatchTagRequest = await request.json();
    const {
      modelId,
      projectPath: rawProjectPath,
      assets,
      options: userOptions,
      vlmOptions: userVlmOptions,
      triggerPhrases = [],
      projectFolderName,
    } = body;

    // Prefer the client's ID (it uses the same value to cancel/reattach);
    // random suffix on the fallback so same-millisecond starts can't collide.
    const batchId =
      body.batchId ??
      `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Validation — must run before any path work so a bad request gets a
    // 400 rather than a throw-into-500 from path resolution.
    if (!modelId) {
      return new Response(JSON.stringify({ error: 'modelId is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!rawProjectPath) {
      return new Response(
        JSON.stringify({ error: 'projectPath is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    if (!assets || !Array.isArray(assets) || assets.length === 0) {
      return new Response(
        JSON.stringify({ error: 'assets array is required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const model = getModel(modelId);
    if (!model) {
      return new Response(JSON.stringify({ error: 'Model not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const status = checkModelStatus(model);
    if (status !== 'ready') {
      return new Response(
        JSON.stringify({ error: 'Model is not installed', status }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    // Resolve to absolute path
    // The projectPath from client could be:
    // 1. An absolute path (e.g., "C:\images\project")
    // 2. A path relative to cwd (e.g., "public/assets/project")
    // 3. Just the project folder name if config uses an absolute projectsFolder
    let projectPath: string;
    if (path.isAbsolute(rawProjectPath)) {
      projectPath = rawProjectPath;
    } else {
      // Check if the path exists as-is (relative to cwd)
      const resolvedPath = path.resolve(rawProjectPath);
      if (fs.existsSync(resolvedPath)) {
        projectPath = resolvedPath;
      } else {
        // Try with the configured projects folder
        const config = getServerConfig();
        projectPath = path.resolve(
          path.join(config.projectsFolder, rawProjectPath),
        );
      }
    }

    const options: TaggerOptions = {
      ...DEFAULT_TAGGER_OPTIONS,
      ...userOptions,
    };

    const vlmOptions: VlmOptions = {
      ...DEFAULT_VLM_OPTIONS,
      ...userVlmOptions,
    };

    // If the user wants trigger phrases injected, append a must-include
    // instruction to the end of the prompt. Done here rather than in the
    // sidecar so the sidecar stays agnostic about project-level concepts.
    // Trailing position matters: VLMs weight the last line of the prompt
    // more heavily than earlier context when deciding what to produce.
    //
    // Phrases are presented as a bulleted list (one per line) instead of a
    // pipe-separated single line. The pipe format invited the model to copy
    // the entire delimiter line verbatim into the caption; a bulleted list
    // looks like data the model has to *read* and weave in, not template
    // text it can echo. The position instruction (prepend/append) tells
    // the model exactly where the phrases should land in the output.
    if (
      vlmOptions.injectTriggerPhrases &&
      triggerPhrases.length > 0 &&
      getProviderTypeForModel(modelId) === 'vlm'
    ) {
      const cleaned = triggerPhrases
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (cleaned.length > 0) {
        const bulletList = cleaned.map((p) => `- ${p}`).join('\n');
        let positionInstruction: string;
        switch (vlmOptions.triggerPhraseInsertMode) {
          case 'prepend':
            positionInstruction =
              'Begin the caption with the phrases above (each on its own line, in the order given), then write the rest of the caption normally on the lines that follow.';
            break;
          case 'integrate':
            // The per-phrase framing is necessary but not sufficient: an
            // earlier version still saw the model dump well-fitting phrases
            // at the end because the base prompt's "max 3 paragraphs" rule
            // was creating budget pressure — by paragraph 3 the model was
            // treating phrase placement as "which paragraph do they live
            // in" rather than "where in the prose do they fit." Two
            // additions resolve that:
            //   (1) "As you write... watch for natural points" reframes
            //       integration as a streaming concern, not a post-hoc
            //       planning one.
            //   (2) The explicit "do not count toward the paragraph or
            //       word budget" line disarms the constraint conflict so
            //       the model can integrate freely without feeling it has
            //       to spend a paragraph on the phrases.
            positionInstruction =
              "Evaluate each phrase on its own. As you write the caption, watch for natural points where a phrase fits into the description — weave it into the prose at that point rather than saving it for later. The trigger phrases above do not count toward the caption's paragraph or word budget. Phrases that genuinely have no natural home in the prose go on their own lines at the very end, after the caption itself is complete. Treat the phrases independently — different phrases may end up in different places.";
            break;
          case 'append':
          default:
            positionInstruction =
              'After finishing the caption, add the phrases above on new lines at the end (each on its own line, in the order given).';
            break;
        }
        vlmOptions.prompt = `${vlmOptions.prompt.trimEnd()}\n\nThe following phrases must each appear in the caption exactly once, character-for-character including punctuation:\n${bulletList}\n\n${positionInstruction}`;
      }
    }

    // Create SSE stream
    const encoder = new TextEncoder();
    const total = assets.length;
    const providerType = getProviderTypeForModel(modelId);
    // Capture narrowed model so nested helpers don't lose the non-null type
    const resolvedModel = model;

    // Register ONNX batches before the stream opens so /batch/active can find
    // them from the first moment. VLM batches get the equivalent registration
    // sidecar-side, inside captionBatchViaSidecar.
    if (providerType !== 'vlm') {
      const created = createOnnxBatch({
        batchId,
        project: projectFolderName,
        modelName: resolvedModel.name,
        total,
      });
      // A running batch already owns this ID — a duplicate submit would
      // interleave two runners into one state object.
      if (!created) {
        return new Response(
          JSON.stringify({ error: 'A batch with this ID is already running' }),
          {
            status: 409,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
    }

    const stream = new ReadableStream({
      async start(controller) {
        // The client's abort (tab close, refresh, navigation) deliberately
        // does NOT stop the run — for either provider. Results keep
        // accumulating (sidecar-side for VLM, in the batch store for ONNX)
        // and the client reattaches via /api/auto-tagger/batch/attach.
        // Once the browser is gone `enqueue` throws, so events from then on
        // go to the store only. Explicit cancellation is /batch/cancel.
        let clientGone = false;
        const sendEvent = (event: TaggingSseEvent) => {
          if (clientGone) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );
          } catch {
            clientGone = true;
          }
        };
        const closeStream = () => {
          try {
            controller.close();
          } catch {
            // Client already disconnected — nothing to close.
          }
        };

        try {
          let outcome: 'complete' | 'cancelled' = 'complete';
          if (providerType === 'vlm') {
            outcome = (await runVlmBatch(sendEvent)) ?? 'complete';
          } else {
            outcome = (await runOnnxBatch(sendEvent)) ?? 'complete';
          }

          if (outcome !== 'cancelled') {
            sendEvent({ type: 'complete', total });
          }
          closeStream();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : 'Batch processing failed';
          if (providerType !== 'vlm') {
            finishOnnxBatch(batchId, 'failed', message);
          }
          sendEvent({ type: 'error', error: message });
          closeStream();
        }
      },
    });

    // --- ONNX (WD14 worker) batch runner ---
    //
    // Semantics for `progress.current`: number of images COMPLETED so far.
    // - At the start, current=0 (from the hook's initial job state).
    // - After each image finishes, current increments.
    // - Final emit guarantees current=total so the progress bar reaches 100%.
    // The display converts `current` to a 1-based label via `min(current+1, total)`.
    //
    // Returns 'cancelled' when a /batch/cancel landed mid-run; undefined for a
    // normal run (the caller emits `complete`). Mirrors runVlmBatch.
    async function runOnnxBatch(
      sendEvent: (event: TaggingSseEvent) => void,
    ): Promise<'cancelled' | undefined> {
      for (let i = 0; i < assets.length; i++) {
        // There's no way to interrupt an in-flight ONNX inference, so a
        // cancel lands at the next image boundary. Results already recorded
        // stay in the store for the client to collect.
        if (isOnnxCancelRequested(batchId)) {
          finishOnnxBatch(batchId, 'cancelled');
          sendEvent({ type: 'cancelled', current: i, total });
          return 'cancelled';
        }

        const asset = assets[i];
        const sourcePath = path.join(
          projectPath,
          `${asset.fileId}.${asset.fileExtension}`,
        );

        // For video assets, tag the extracted poster frame instead of the
        // raw video file (the WD14 worker only knows how to load images).
        let imagePath: string | null = sourcePath;
        if (isSupportedVideoExtension(`.${asset.fileExtension}`)) {
          imagePath = await ensureVideoPoster(sourcePath);
        }

        if (!imagePath) {
          const error = 'Failed to extract poster frame from video';
          appendOnnxResult(batchId, { itemId: asset.fileId, error });
          sendEvent({ type: 'error', fileId: asset.fileId, error });
          const completed = i + 1;
          const nextFileId = assets[i + 1]?.fileId ?? asset.fileId;
          sendEvent({
            type: 'progress',
            current: completed,
            total,
            fileId: nextFileId,
          });
          continue;
        }

        try {
          const output = await tagImageInWorker(
            resolvedModel,
            imagePath,
            options,
          );

          const allTags: TagResult[] = [];
          allTags.push(...output.general);
          if (options.includeCharacterTags) allTags.push(...output.character);
          if (options.includeRatingTags && output.rating.length > 0) {
            allTags.push(output.rating[0]);
          }
          const includedTags = (options.includeTags || []).map((tag) => ({
            tag,
            confidence: 1.0,
          }));
          allTags.push(...includedTags);

          allTags.sort((a, b) => b.confidence - a.confidence);
          let tagNames = allTags.map((t) => t.tag);
          tagNames = [...new Set(tagNames)];

          const result = {
            itemId: asset.fileId,
            fileName: displayName(imagePath, projectPath),
            tags: tagNames,
          };
          appendOnnxResult(batchId, result);
          sendEvent({
            type: 'result',
            fileId: asset.fileId,
            fileName: result.fileName,
            tags: tagNames,
          });
        } catch (err) {
          const error = err instanceof Error ? err.message : 'Unknown error';
          appendOnnxResult(batchId, { itemId: asset.fileId, error });
          sendEvent({ type: 'error', fileId: asset.fileId, error });
        }

        // Emit completion of this image. `current` = images completed so far.
        // The UI derives the "currently processing" label as min(current+1, total).
        const completed = i + 1;
        const nextFileId = assets[i + 1]?.fileId ?? asset.fileId;
        sendEvent({
          type: 'progress',
          current: completed,
          total,
          fileId: nextFileId,
        });
      }

      finishOnnxBatch(batchId, 'completed');
      return undefined;
    }

    // --- VLM (sidecar) batch runner ---
    // Returns 'cancelled' when the sidecar reports the batch was cancelled;
    // undefined for a normal run (the caller emits `complete`).
    async function runVlmBatch(
      sendEvent: (event: TaggingSseEvent) => void,
    ): Promise<'cancelled' | undefined> {
      // Build the item list for the sidecar. Each item carries the asset's
      // fileId as its item_id, so every progress event and stored result
      // comes back tagged with the asset it belongs to — no index or path
      // mapping to keep in sync.
      //
      // Video handling depends on whether the selected model can natively
      // process video frames:
      //  - supportsVideo: pass the raw .mp4 path straight through to the
      //    sidecar; the transformers provider samples frames internally
      //    via qwen-vl-utils.
      //  - !supportsVideo: substitute an extracted poster frame so the
      //    image-only provider can still produce a (less accurate) caption.
      // Per-asset poster extraction failures drop that asset from the
      // sidecar batch and surface as a per-asset error.
      const modelSupportsVideo = resolvedModel.supportsVideo === true;
      const items: CaptionBatchItem[] = [];
      for (const asset of assets) {
        const sourcePath = path.join(
          projectPath,
          `${asset.fileId}.${asset.fileExtension}`,
        );
        let resolved: string | null = sourcePath;
        if (isSupportedVideoExtension(`.${asset.fileExtension}`)) {
          if (modelSupportsVideo) {
            // Pass the raw video path through; the sidecar handles sampling.
            resolved = sourcePath;
          } else {
            resolved = await ensureVideoPoster(sourcePath);
          }
        }
        if (!resolved) {
          sendEvent({
            type: 'error',
            fileId: asset.fileId,
            error: 'Failed to extract poster frame from video',
          });
          continue;
        }
        items.push({ path: resolved, itemId: asset.fileId });
      }

      // If every asset was a failed-extraction video, there's nothing to
      // send to the sidecar — bail before opening a WebSocket.
      if (items.length === 0) {
        return;
      }

      // Per-image events come back keyed by itemId only; keep the path each
      // one resolved to so results can name a thumbnail (poster vs. original).
      const pathByItemId = new Map(items.map((i) => [i.itemId, i.path]));
      const itemIds = items.map((i) => i.itemId);

      // NOTE: the client's abort (tab close, navigation) deliberately does
      // NOT cancel the sidecar batch any more. The batch keeps running,
      // results accumulate sidecar-side, and the client reattaches via
      // /api/auto-tagger/batch/attach. Explicit cancellation goes through
      // /api/auto-tagger/batch/cancel instead.

      // Same semantics as runOnnxBatch: `current` = images completed so far.
      // Starts at the dropped-video count so the numerator still reaches
      // `total` (dropped videos were errored above before the sidecar runs).
      const dropped = assets.length - items.length;

      // The sidecar-event → SSE mapping is shared with the reattach route (the
      // two had already drifted); only the context differs. This route knows
      // the batch's items because it sent them.
      for await (const event of translateVlmBatchEvents(
        captionBatchViaSidecar(
          resolvedModel,
          items,
          vlmOptions,
          batchId,
          projectFolderName,
        ),
        {
          counters: { total, completed: dropped },
          fileNameFor: ({ itemId }) => {
            const resolvedPath = pathByItemId.get(itemId);
            return resolvedPath
              ? displayName(resolvedPath, projectPath)
              : undefined;
          },
          itemIdAt: (index) => itemIds[index],
        },
      )) {
        sendEvent(event);
        // Said explicitly by the sidecar (queue removal, a cancel from another
        // tab); the caller must not follow it with a `complete`.
        if (event.type === 'cancelled') return 'cancelled';
      }
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Batch tagging error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to start batch tagging' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}
