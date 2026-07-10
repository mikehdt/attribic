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


class StartJobRequest(BaseModel):
    project_path: str
    provider: ProviderType
    base_model: str
    output_path: str
    output_name: str
    datasets: list[DatasetEntry]
    hyperparameters: dict
    sample_prompts: list[str] = []


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
    learning_rate: Optional[float] = None
    eta_seconds: Optional[int] = None
    sample_image_paths: list[str] = []
    # PREDICTED checkpoint step positions, computed once from the job's save
    # cadence at start. Persisted so the UI's upcoming-save ticks survive a
    # page refresh rather than being re-derived client-side.
    checkpoint_steps: list[int] = []
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


class JobState(BaseModel):
    job_id: str
    status: JobStatus
    provider: ProviderType
    project_path: str
    config: dict
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    progress: JobProgress


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.1.0"
    active_job: Optional[str] = None


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
