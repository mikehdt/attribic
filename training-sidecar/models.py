"""Pydantic models for the training sidecar API."""

from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel

# Which Python runtime loads a VLM model.
VlmRuntime = Literal["llama-cpp", "transformers"]


class ProviderType(str, Enum):
    AI_TOOLKIT = "ai-toolkit"
    KOHYA = "kohya"
    MOCK = "mock"


class JobStatus(str, Enum):
    PENDING = "pending"
    PREPARING = "preparing"
    TRAINING = "training"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LossPoint(BaseModel):
    """A single downsampled point on the training loss curve."""

    step: int
    loss: float


class SpeedPoint(BaseModel):
    """A single downsampled point on the training speed curve.

    Stored as seconds-per-iteration (normalised from the trainer's it/s or
    s/it rate) so the client can plot a consistent s/it series regardless of
    which unit the backend printed.
    """

    step: int
    sec_per_it: float


class SampleImage(BaseModel):
    """A training-time sample image discovered on disk by the provider.

    Emitted with a path relative to the job's output_path (the loras root),
    using POSIX separators so the client can build a serving URL without
    knowing the machine's absolute layout. Step and prompt index are recovered
    from the filename; epoch is only set for Kohya epoch-cadence runs.

    `path` normally points into the run's archive folder, since providers copy
    each sample there as soon as they see it (see `sample_archive`), with
    `source_path` holding the trainer's original so it can be swept when the
    run ends. When the copy couldn't be made, `path` is the original and
    `source_path` is None.
    """

    path: str
    step: int  # 0 if unknown
    epoch: int | None = None  # Kohya epoch-cadence runs only
    prompt_index: int
    source_path: str | None = None


class SampleProgress(BaseModel):
    """Diffusion-step progress of the sample image being rendered right now.

    Only meaningful while the trainer is paused generating samples; backends
    that don't expose a per-image bar simply never report it (the UI then shows
    an indeterminate bar for the duration).
    """

    current: int
    total: int


class DatasetEntry(BaseModel):
    path: str
    num_repeats: int = 1
    # Per-folder overrides — defaults preserve prior behaviour when the Node
    # side doesn't supply them.
    lora_weight: float = 1.0
    is_regularization: bool = False
    # Per-folder augmentation controls, forwarded from the UI's folder-level
    # settings. Providers previously read these from top-level hyperparameters
    # (never actually sent by the client); they now come from here instead.
    caption_shuffling: bool = False
    keep_tokens: int = 0
    caption_dropout_rate: float = 0.0
    flip_augment: bool = False
    # Vertical flip — only ai-toolkit supports this (flip_y); sd-scripts/Kohya
    # has no vertical-flip augmentation and ignores this field.
    flip_v_augment: bool = False


class ProjectRef(BaseModel):
    """The saved training project a run was launched from.

    Snapshotted at launch rather than looked up later: a project can be
    renamed, re-versioned or deleted while its runs live on, and a past run
    should still say what it was trained from. `id` is what the client matches
    a project's own runs on, since it survives a rename where `name` doesn't.
    """

    id: Optional[str] = None
    name: str
    version: int = 1


class StartJobRequest(BaseModel):
    project_path: str
    provider: ProviderType
    base_model: str
    output_path: str
    output_name: str
    datasets: list[DatasetEntry]
    hyperparameters: dict
    sample_prompts: list[str] = []
    # Per-prompt sample image size as [width, height], index-aligned with
    # sample_prompts. Providers turn these into the `--w`/`--h` flags both
    # backends parse off a prompt line. Absent/short = fall back to the run's
    # default sample size, which is what clients predating this field send.
    sample_sizes: list[list[int]] = []
    # Client-owned metadata the sidecar stores verbatim and never interprets.
    # Both exist so a run's record on disk can rebuild the client's whole view
    # of it without a browser-side archive: `project` is what the project menu
    # filters its own runs on, and `form_snapshot` is the launch form exactly as
    # submitted, kept so a past run's settings can be loaded back into the form.
    project: Optional[ProjectRef] = None
    form_snapshot: Optional[dict] = None
    # The client's own summary of the run, as it renders it. Stored so a run
    # read back off disk redisplays exactly as it did live — rebuilding it from
    # the fields above is lossy (no datasets, one resolution, no expert
    # settings), which would make a reloaded run's detail view quietly poorer
    # than the same run before the reload.
    client_config: Optional[dict] = None

    def sample_size_at(
        self, index: int, default_w: int, default_h: int
    ) -> tuple[int, int]:
        """Size for the prompt at `index`, falling back to the run's default
        sample size when the client didn't send one (or sent something
        malformed)."""
        if 0 <= index < len(self.sample_sizes):
            size = self.sample_sizes[index]
            if len(size) == 2 and size[0] > 0 and size[1] > 0:
                return int(size[0]), int(size[1])
        return default_w, default_h


class JobProgress(BaseModel):
    job_id: str
    status: JobStatus
    current_step: int = 0
    total_steps: int = 0
    current_epoch: int = 0
    total_epochs: int = 0
    loss: Optional[float] = None
    # Downsampled loss curve accumulated centrally by the JobManager across
    # the whole run (providers only report the latest `loss`; the manager
    # appends and bounds the series). Survives state persistence + rehydration.
    loss_history: list[LossPoint] = []
    # Downsampled speed curve (seconds-per-iteration), accumulated centrally in
    # lockstep with loss_history at the same downsampled steps. Empty for
    # providers/backends that don't report an iteration rate.
    speed_history: list[SpeedPoint] = []
    # Transient speed curve for the *current* setup phase (caching latents /
    # text-encoder outputs), keyed by that phase's item index. Populated only
    # while PREPARING, reset when the caching phase changes, and cleared once
    # training proper begins — it is deliberately not part of the persisted
    # training speed_history.
    prep_speed_history: list[SpeedPoint] = []
    learning_rate: Optional[float] = None
    eta_seconds: Optional[int] = None
    samples: list[SampleImage] = []
    # PREDICTED checkpoint step positions, computed once from the job's save
    # cadence at start. Persisted so the UI's upcoming-save ticks survive a
    # page refresh rather than being re-derived client-side.
    checkpoint_steps: list[int] = []
    # PREDICTED sample-generation step positions, computed from the sampling
    # cadence at start (empty when sampling is off or there are no prompts).
    # Persisted for the same reason as checkpoint_steps. Unrelated to the
    # hyperparameters' `sample_steps`, which is inference steps per image.
    sample_steps: list[int] = []
    # Steps at which a checkpoint was CONFIRMED written on disk. Deduped by
    # the JobManager (a provider may report the same save more than once).
    saved_checkpoints: list[int] = []
    log_lines: list[str] = []
    error: Optional[str] = None
    # Human-readable activity label. During PREPARING it names the setup phase
    # (e.g. "Caching latents"), and current_step/total_steps carry that phase's
    # item count rather than training steps. During TRAINING it names a
    # transient activity between steps (e.g. "Saving checkpoint"), or is null
    # while steps are actively advancing.
    phase: Optional[str] = None
    # Iteration rate as reported by the trainer, e.g. "2.30 it/s" / "23.01 s/it".
    speed: Optional[str] = None
    # Diffusion-step progress of the sample image currently being rendered.
    # Set only during a sampling pause and only by backends whose logs expose
    # the sampler's own bar (Kohya); null everywhere else, including the moment
    # sampling ends — a training tick clears it by simply omitting it.
    sample_progress: Optional[SampleProgress] = None
    # Cumulative wall-time (seconds) spent actively TRAINING, accumulated
    # centrally by the JobManager from the gaps between TRAINING-status ticks —
    # so it excludes queueing/preparing (model load, latent caching) and, unlike
    # the trainer's per-process tqdm elapsed, carries across a stop → resume via
    # a marker file next to the saved state (see training_time.py). Distinct
    # from the JobState started_at/completed_at wall-clock span.
    training_seconds: float = 0.0


class JobState(BaseModel):
    """A training run's durable record — the single source of truth for it.

    Written to `<training>/jobs/<job_id>.json` at launch and updated as the run
    progresses, so it outlives the sidecar process, the browser tab and the
    browser itself. Everything the client renders for a run is reconstructable
    from here, which is why the client-side fields (`project`, `form_snapshot`)
    ride along even though the sidecar never reads them.
    """

    job_id: str
    status: JobStatus
    provider: ProviderType
    project_path: str
    config: dict
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    progress: JobProgress
    # Carried through from the launch request — see StartJobRequest.
    project: Optional[ProjectRef] = None
    form_snapshot: Optional[dict] = None
    client_config: Optional[dict] = None
    # Cleared from the activity panel by the user. The run stays on disk and in
    # run history; this only keeps its card out of the panel and stops the
    # single-job status view offering it, so a refresh doesn't re-surface it.
    # Deleting a run for good is a separate, explicit action in run history.
    dismissed: bool = False


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    active_job: Optional[str] = None


class GpuStats(BaseModel):
    """One GPU's current load, as reported by nvidia-smi.

    Every figure is optional because nvidia-smi answers `[N/A]` for anything a
    given card or driver doesn't expose (temperature on some virtualised GPUs,
    for instance).
    """

    index: int
    name: str
    utilization: Optional[float] = None  # percent
    memory_used_mb: Optional[float] = None
    memory_total_mb: Optional[float] = None
    temperature_c: Optional[float] = None


class SystemStats(BaseModel):
    """Host load at a moment in time — machine-wide, not per-job.

    Fields are optional so a host missing a source (no psutil, no NVIDIA GPU)
    still gets a valid response with the parts it can measure.
    """

    cpu_percent: Optional[float] = None
    memory_used_mb: Optional[float] = None
    memory_total_mb: Optional[float] = None
    gpus: list[GpuStats] = []


class StartJobResponse(BaseModel):
    job_id: str
    status: JobStatus


class ErrorResponse(BaseModel):
    error: str


# ---------------------------------------------------------------------------
# Captioning (VLM) models
# ---------------------------------------------------------------------------


class VideoSamplingOptions(BaseModel):
    """
    Per-batch video sampling controls. The provider derives the actual fps
    per video as `min(max_fps, frame_budget / duration_seconds)` so a long
    clip gets uniform coverage and a short clip doesn't oversample.

    Only meaningful for providers that natively process video frames
    (currently transformers / Qwen-VL). Image-only providers ignore these.
    """

    frame_budget: int = 32
    max_fps: float = 2.0
    # Pixel budget per sampled frame. Larger = more detail per frame but
    # more VRAM and slower inference. The Node side maps a quality preset
    # (low/standard/high) to a concrete number before sending.
    max_pixels: int = 360 * 420


class CaptionRequest(BaseModel):
    """Single image caption request."""

    image_path: str
    model_path: str
    runtime: VlmRuntime = "llama-cpp"
    prompt: str = "Describe this image in detail for AI training purposes."
    max_tokens: int = 512
    temperature: float = 0.7
    video: Optional[VideoSamplingOptions] = None


class CaptionResponse(BaseModel):
    """Single image caption response."""

    image_path: str
    caption: str


class CaptionBatchRequest(BaseModel):
    """Batch captioning request — streams progress via WebSocket."""

    batch_id: str
    image_paths: list[str]
    # Opaque per-image IDs, parallel to image_paths. The client supplies its
    # own identifiers (fileIds) so progress events and stored results can be
    # matched back without fragile index-based mapping. Falls back to the
    # image path when omitted.
    item_ids: Optional[list[str]] = None
    # Client-side grouping key (project folder name) so a reconnecting
    # client can find its batches via GET /caption/batches.
    project: Optional[str] = None
    model_path: str
    runtime: VlmRuntime = "llama-cpp"
    prompt: str = "Describe this image in detail for AI training purposes."
    max_tokens: int = 512
    temperature: float = 0.7
    video: Optional[VideoSamplingOptions] = None


class CaptionBatchProgress(BaseModel):
    """
    Progress update for a batch caption run. Broadcast via /ws/caption.

    Status meanings:
    - 'queued':    waiting in the job queue behind other GPU work.
                   `queue_position` is the 1-indexed place in line.
    - 'loading':   model is being loaded onto GPU/CPU. `current`/`total` reflect
                   loading-step progress (e.g. safetensors shards), not image count.
                   `message` describes what's happening.
    - 'running':   actively processing images. `current`/`total` are image counts.
    - 'completed' / 'failed' / 'cancelled': terminal states.
    """

    batch_id: str
    current: int
    total: int
    image_path: Optional[str] = None
    # Client-supplied ID for the image this event refers to (see
    # CaptionBatchRequest.item_ids).
    item_id: Optional[str] = None
    caption: Optional[str] = None
    status: str = "running"  # queued, loading, running, completed, failed, cancelled
    error: Optional[str] = None
    # Free-form status text, used for loading messages like "Loading checkpoint shards"
    message: Optional[str] = None
    # 1-indexed place in the job queue; only set on 'queued' events.
    queue_position: Optional[int] = None


class CaptionBatchResponse(BaseModel):
    """Response for starting a batch caption run."""

    batch_id: str
    status: str = "started"
    total: int
