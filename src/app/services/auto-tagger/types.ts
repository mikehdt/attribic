/**
 * Types for the auto-tagger service
 * Supports ONNX booru taggers (Node.js) and NL vision-language models (Python sidecar)
 */

/** How the provider runs inference */
export type ProviderType = 'onnx' | 'vlm';

/**
 * What a VLM batch is asked to produce. 'caption' is the classic
 * natural-language captioner; 'tags' prompts the model for an imageboard-style
 * comma-separated tag list, which the client parses into the tag block the way
 * an ONNX result is. Derived from the project's caption mode — a tag-mode
 * project runs VLMs as taggers, every other mode as captioners.
 */
export type VlmOutputTarget = 'caption' | 'tags';

/**
 * Which Python runtime handles a VLM model.
 * - 'llama-cpp': GGUF quants via llama-cpp-python (CPU / Linux CUDA)
 * - 'transformers': HuggingFace transformers + PyTorch (Windows CUDA path)
 *
 * Ignored for 'onnx' provider models.
 */
export type VlmRuntime = 'llama-cpp' | 'transformers';

export type TaggerProvider = {
  id: string;
  name: string;
  description: string;
  providerType: ProviderType;
  models: TaggerModel[];
};

export type TaggerModel = {
  id: string;
  name: string;
  provider: string;
  repoId: string;
  files: ModelFile[];
  description?: string;
  isDefault?: boolean;
  /** VRAM estimate in GB for VLM models (helps users pick the right quant) */
  vramEstimate?: number;
  /**
   * Which Python runtime loads this model. Only meaningful for VLM models.
   * Defaults to 'llama-cpp' for backwards compatibility with existing GGUF entries.
   */
  runtime?: VlmRuntime;
  /**
   * Whether this model can natively process video frames. True for Qwen-VL
   * via transformers (real video token support), false/undefined for GGUF
   * (which only sees stills). Videos sent to a non-video model fall back
   * to poster-frame substitution upstream of the sidecar.
   */
  supportsVideo?: boolean;
  /**
   * Per-model defaults for the video sampling controls. Lets a smaller
   * model ship with a larger frame budget than a memory-heavier one
   * without the user having to know the math.
   */
  videoDefaults?: VlmVideoOptions;
};

type ModelFile = {
  name: string;
  size: number;
};

export type TagResult = {
  tag: string;
  confidence: number;
};

export type TaggerOutput = {
  general: TagResult[];
  character: TagResult[];
  rating: TagResult[];
};

export type TagInsertMode = 'prepend' | 'append';

/**
 * Where injected trigger phrases should land in a VLM-generated caption.
 * Distinct from `TagInsertMode` because 'integrate' has no analogue in the
 * ONNX tagging flow — it asks the model to weave phrases into the prose
 * where they fit naturally, falling back to append for ones that don't.
 */
export type TriggerPhraseInsertMode = 'prepend' | 'integrate' | 'append';

/**
 * Frame quality preset for video captioning. Maps to a `max_pixels` value
 * the qwen-vl-utils video reader uses to resize each sampled frame before
 * passing it to the model. Higher quality = bigger VRAM footprint per frame
 * = slower inference, but more visual detail per frame.
 */
export type VlmVideoQuality = 'low' | 'standard' | 'high';

/**
 * Per-batch video sampling controls. Only applied when at least one selected
 * asset is a video AND the chosen model declares `supportsVideo: true`.
 * The actual `fps` per video is derived as `min(maxFps, frameBudget/duration)`
 * so a 5-minute clip still gets uniform coverage across its full length while
 * a 5-second clip doesn't oversample.
 */
type VlmVideoOptions = {
  /** Total frames sampled across the whole clip, regardless of duration. */
  frameBudget: number;
  /** Hard cap on sample rate so short clips don't oversample. */
  maxFps: number;
  /** Quality preset — controls the per-frame resolution sent to the model. */
  quality: VlmVideoQuality;
};

/**
 * `max_pixels` value passed to qwen-vl-utils for each quality preset.
 * Numbers are roughly the patch counts Qwen recommends for video frames.
 */
export const VLM_VIDEO_QUALITY_PIXELS: Record<VlmVideoQuality, number> = {
  low: 280 * 320,
  standard: 360 * 420,
  high: 560 * 640,
};

export type TaggerOptions = {
  generalThreshold: number;
  characterThreshold: number;
  removeUnderscore: boolean;
  includeCharacterTags: boolean;
  includeRatingTags: boolean;
  excludeTags: string[];
  includeTags: string[];
  tagInsertMode: TagInsertMode;
};

export const DEFAULT_TAGGER_OPTIONS: TaggerOptions = {
  generalThreshold: 0.3,
  characterThreshold: 0.9,
  removeUnderscore: true,
  includeCharacterTags: false,
  includeRatingTags: false,
  excludeTags: [],
  includeTags: [],
  tagInsertMode: 'append',
};

/**
 * VLM (natural-language captioner) options.
 * Used when the selected model's provider is 'vlm'.
 */
export type VlmOptions = {
  prompt: string;
  maxTokens: number;
  temperature: number;
  /**
   * If true, the project's trigger phrases are appended to the prompt as a
   * must-include instruction. The backend handles the actual injection at
   * request time so the prompt the user edits stays clean.
   */
  injectTriggerPhrases: boolean;
  /**
   * Where injected trigger phrases should land in the generated caption.
   * - 'prepend':   model places them at the very start, then writes the caption
   * - 'integrate': model weaves them into the prose where they fit, falling
   *                back to the end for phrases that don't fit naturally
   * - 'append':    model writes the caption first, then lists them at the end
   */
  triggerPhraseInsertMode: TriggerPhraseInsertMode;
  /** Per-batch video sampling controls. Ignored when no videos are in scope. */
  video: VlmVideoOptions;
};

export const DEFAULT_VLM_OPTIONS: VlmOptions = {
  // Prompt notes:
  // - Example-based priming works better than negative instructions alone;
  //   VLMs are trained on markdown-heavy data and "please don't" loses.
  // - Strict rules go LAST because VLMs weight the end of the prompt more.
  // - The blob is only ever *half* a hybrid caption: the tag block already
  //   carries style, framing, counts and appearance. Anything the blob repeats
  //   is specified twice, which splits the gradient between the tag and the
  //   prose and starves character tokens of the features that define them.
  //   So the blob's job is narrow — spatial arrangement and action, the two
  //   things a flat tag list genuinely cannot express.
  // - Negations are the big one. "No weapons are visible" puts `weapons` into
  //   the conditioning vector; diffusion has no negation operator, so the
  //   sentence does the opposite of what it reads like. VLMs volunteer these
  //   constantly, and a bare "don't" doesn't stop it — hence the positive
  //   reframe ("say nothing at all about it") plus an example that models it.
  // - Kept short partly for small models: a 4B VLM handed a six-item checklist
  //   and seven rules quietly drops half of them. Two asks, then the rules.
  prompt: [
    'Write a short, factual description of this image for a training caption. It sits alongside a list of tags that already cover art style, framing, and appearance, so describe only what tags cannot: where things are, how they relate to each other, and what they are doing.',
    '',
    'One or two sentences, 25–50 words, plain prose. Like this example:',
    '',
    'A man in a long coat stands at the left edge of a rooftop, facing right towards a seated figure leaning against the parapet. A metal ladder runs up the wall between them.',
    '',
    'STRICT RULES — your response MUST follow these:',
    '- One or two sentences. Stop after the second.',
    '- Describe only what is present. If something is absent, say nothing at all about it — never write that anything is missing, empty, plain, bare, or not visible.',
    '- State what you see directly. Do not write "suggesting", "possibly", "appears to", "as if", or "implying".',
    '- Leave out art style, medium, lighting, colour palette and composition. Leave out hair, eye and clothing colour. The tags already cover all of these.',
    '- Leave out mood, atmosphere, symbolism, and what the scene implies.',
    '- Plain prose only. No markdown, no **bold**, no bullet points, no headings.',
  ].join('\n'),
  maxTokens: 160,
  temperature: 0.3,
  injectTriggerPhrases: true,
  triggerPhraseInsertMode: 'append',
  video: {
    frameBudget: 32,
    maxFps: 2.0,
    quality: 'standard',
  },
};

/**
 * Default prompt for a VLM run whose output target is 'tags' — asks for a flat
 * imageboard-style tag list instead of prose. Same prompt-shape lessons as the
 * caption default: an example primes the format better than instructions
 * alone, and the strict rules go last because VLMs weight the end of the
 * prompt more.
 */
export const DEFAULT_VLM_TAG_PROMPT = [
  'Tag this image with a flat, comma-separated list of imageboard-style (Danbooru) tags for a training caption. Cover the subject count and type, appearance, clothing, pose, expression, actions, notable objects, setting, and framing.',
  '',
  'Example output:',
  '',
  '1girl, long hair, red hair, green eyes, white dress, sitting, park bench, autumn leaves, smiling, looking at viewer, outdoors, full body',
  '',
  'STRICT RULES — your response MUST follow these:',
  '- Output ONLY the comma-separated tag list — no sentences, no explanations, no headings, no markdown.',
  '- Each tag is one short lowercase phrase of one to three words.',
  '- 10 to 30 tags, most important first.',
  '- Tag only what is visible. If something is absent, say nothing about it — never tag anything as missing, empty, or plain.',
  '- Do not repeat tags.',
].join('\n');

/**
 * Settings saved to project config.
 * Both ONNX and VLM fields are optional — a project tracks defaults for
 * whichever providers it's been used with.
 */
export type AutoTaggerSettings = {
  defaultModelId?: string;
} & Partial<Omit<TaggerOptions, 'includeTags'>> & // includeTags not saved (session only)
  Partial<VlmOptions>;

/**
 * The SSE vocabulary a batch stream speaks — one shape per event type, shared
 * by the producers (`/api/auto-tagger/batch` and `/batch/attach`) and the
 * client that consumes them. Both routes previously built these shapes inline
 * from a single loose type with every field optional, and the client parsed
 * them into `any`; a field one route forgot to send was invisible on both
 * sides. Discriminating on `type` means the compiler now decides which fields
 * an event has.
 *
 * Live and reattached streams are deliberately identical, so the client
 * processes both with the same code whichever provider ran the batch.
 */
export type TaggingSseEvent =
  /** Waiting in the sidecar's GPU queue. `position` is 1-indexed. */
  | { type: 'queued'; position: number; current: number; total: number }
  /** Model load progress. `current`/`total` count shards, not images. */
  | { type: 'loading'; message: string; current: number; total: number }
  /** Model load finished; `fileId` is the image about to be processed. */
  | { type: 'loaded'; current: number; total: number; fileId?: string }
  /** One image finished (successfully or not). `current` = images done. */
  | { type: 'progress'; current: number; total: number; fileId?: string }
  /** A per-image result. Carries `tags` (ONNX) or `caption` (VLM). */
  | {
      type: 'result';
      fileId: string;
      /** File actually fed to the model, for the thumbnail. */
      fileName?: string;
      tags?: string[];
      caption?: string;
    }
  /** With `fileId`: this image failed. Without: the whole batch failed. */
  | { type: 'error'; fileId?: string; error: string }
  | { type: 'cancelled'; current: number; total: number }
  | { type: 'complete'; total: number };
