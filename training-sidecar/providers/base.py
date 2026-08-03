"""Abstract base class for training providers."""

from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Optional

from models import JobProgress, StartJobRequest


class TrainingProvider(ABC):
    """Abstract interface for training backends (ai-toolkit, Kohya, etc.)."""

    # How training-time markers are laid out on disk (see `training_time.py`):
    # "per-state-dir" — a marker beside each <output>-NNNNNN-state dir (sd-scripts lineage)
    # "single-root"   — one marker in the run's save_root (ai-toolkit)
    time_marker_policy: str = "single-root"

    @abstractmethod
    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        """Check that the backend tools are installed and accessible.

        Returns:
            (is_valid, error_message) — error_message is None when valid.
        """
        ...

    @abstractmethod
    async def generate_config(
        self, request: StartJobRequest, config_dir: str
    ) -> str:
        """Generate a backend-specific config file from the generic request.

        Returns:
            Path to the generated config file.
        """
        ...

    @abstractmethod
    async def start_training(
        self,
        request: StartJobRequest,
        config_path: str,
        gpu_id: int = 0,
        job_id: Optional[str] = None,
    ) -> AsyncGenerator[JobProgress, None]:
        """Start training and yield progress updates.

        This method spawns the training subprocess and parses its output,
        yielding JobProgress objects as training proceeds.

        `gpu_id` selects which GPU the training job should use. Providers
        either pass this to their underlying backend (ai-toolkit's
        `gpu_ids` / `device` fields) or export `CUDA_VISIBLE_DEVICES` when
        spawning a subprocess.

        `job_id` is the manager's id for this run — the key the per-run sample
        archive folder is named for (see `sample_archive`). Providers set their
        own `JobProgress.job_id` and the manager overwrites it, so this is
        passed separately rather than read back off the yielded progress.
        """
        ...

    @abstractmethod
    async def cancel_training(self, job_id: str) -> None:
        """Cancel the run the manager knows as `job_id`. No-op if unknown."""
        ...

    @abstractmethod
    def get_supported_models(self) -> list[dict]:
        """Return list of base models this provider supports.

        Each dict should contain at least: id, name, architecture.
        """
        ...

    def validate_request(self, request: StartJobRequest) -> list[str]:
        """Cheap semantic checks before enqueue. Default: no extra checks."""
        return []
