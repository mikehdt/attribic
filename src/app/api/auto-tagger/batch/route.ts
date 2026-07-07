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
  TagResult,
  VlmOptions,
} from '@/app/services/auto-tagger';
import {
  DEFAULT_TAGGER_OPTIONS,
  DEFAULT_VLM_OPTIONS,
  getModel,
  getProviderTypeForModel,
} from '@/app/services/auto-tagger';
import { checkModelStatus } from '@/app/services/auto-tagger/model-manager';
import type { CaptionBatchItem } from '@/app/services/auto-tagger/providers/vlm/client';
import { captionBatchViaSidecar } from '@/app/services/auto-tagger/providers/vlm/client';
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

type BatchProgressEvent = {
  type:
    | 'progress'
    | 'result'
    | 'complete'
    | 'error'
    | 'loading'
    | 'loaded'
    | 'queued'
    | 'cancelled';
  /** 1-indexed queue position, on `queued` events only. */
  position?: number;
  current?: number;
  total?: number;
  fileId?: string;
  /** ONNX tagger result — comma-separated tags for the image */
  tags?: string[];
  /** VLM captioner result — natural-language caption for the image */
  caption?: string;
  error?: string;
  /** Free-form status text for `loading` events (e.g. "Loading checkpoint shards") */
  message?: string;
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

    // Validation
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

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: BatchProgressEvent) => {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        };

        try {
          let outcome: 'complete' | 'cancelled' = 'complete';
          if (providerType === 'vlm') {
            outcome = (await runVlmBatch(sendEvent)) ?? 'complete';
          } else {
            await runOnnxBatch(sendEvent);
          }

          if (outcome !== 'cancelled') {
            sendEvent({ type: 'complete', total });
          }
          controller.close();
        } catch (err) {
          sendEvent({
            type: 'error',
            error:
              err instanceof Error ? err.message : 'Batch processing failed',
          });
          controller.close();
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
    async function runOnnxBatch(
      sendEvent: (event: BatchProgressEvent) => void,
    ) {
      for (let i = 0; i < assets.length; i++) {
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
          sendEvent({
            type: 'error',
            fileId: asset.fileId,
            error: 'Failed to extract poster frame from video',
          });
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

          sendEvent({
            type: 'result',
            fileId: asset.fileId,
            tags: tagNames,
          });
        } catch (err) {
          sendEvent({
            type: 'error',
            fileId: asset.fileId,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
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
    }

    // --- VLM (sidecar) batch runner ---
    // Returns 'cancelled' when the sidecar reports the batch was cancelled;
    // undefined for a normal run (the caller emits `complete`).
    async function runVlmBatch(
      sendEvent: (event: BatchProgressEvent) => void,
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

      // NOTE: the client's abort (tab close, navigation) deliberately does
      // NOT cancel the sidecar batch any more. The batch keeps running,
      // results accumulate sidecar-side, and the client reattaches via
      // /api/auto-tagger/batch/attach. Explicit cancellation goes through
      // /api/auto-tagger/batch/cancel instead.

      // Same semantics as runOnnxBatch: `current` = images completed so far.
      // Starts at the dropped-video count so the numerator still reaches
      // `total` (dropped videos were errored above before the sidecar runs).
      const dropped = assets.length - items.length;
      let completed = dropped;

      const generator = captionBatchViaSidecar(
        resolvedModel,
        items,
        vlmOptions,
        batchId,
        projectFolderName,
      );

      for await (const event of generator) {
        // Waiting in the sidecar's job queue behind other GPU work
        // (training run, another caption batch). Forwarded so the UI can
        // show "Queued — position N" instead of a dead "Starting..." bar.
        if ('queued' in event) {
          sendEvent({
            type: 'queued',
            position: event.position,
            current: completed,
            total,
          });
          continue;
        }

        // Loading progress from the sidecar — forwarded as-is so the UI
        // can show "Loading checkpoint shards 1/2" during the first-use
        // model load. No completion-count bump; loading is a side-channel.
        if ('loading' in event) {
          sendEvent({
            type: 'loading',
            message: event.message,
            current: event.current,
            total: event.total,
          });
          continue;
        }

        // Sidecar-side cancellation (queue removal, cancel from another
        // tab). Tell the browser explicitly — a bare `complete` here made
        // a cancelled batch look like a finished one.
        if ('cancelled' in event) {
          sendEvent({ type: 'cancelled', current: completed, total });
          return 'cancelled';
        }

        // Load complete — emit a `loaded` event so the client can show the
        // loading bar at 100% briefly before transitioning to the
        // image-counter view. The client handles the 100%-fill + brief
        // pause + switch-to-tagging dance; doing it server-side would
        // hold the SSE stream open while the sidecar starts inference.
        if ('loadingComplete' in event) {
          sendEvent({
            type: 'loaded',
            current: completed,
            total,
            fileId: items[0]?.itemId,
          });
          continue;
        }

        // Per-image events arrive tagged with the asset's fileId (item_id).
        if ('error' in event) {
          sendEvent({
            type: 'error',
            fileId: event.itemId,
            error: event.error,
          });
        } else {
          sendEvent({
            type: 'result',
            fileId: event.itemId,
            caption: event.caption,
          });
        }

        // Advance completion count after each event (success or error).
        // The sidecar processes items in order, so the next item's fileId
        // makes an accurate "currently processing" label.
        completed++;
        const nextFileId = items[completed - dropped]?.itemId ?? event.itemId;
        sendEvent({
          type: 'progress',
          current: completed,
          total,
          fileId: nextFileId,
        });
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
