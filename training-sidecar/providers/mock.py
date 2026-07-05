"""Mock training provider.

Simulates a training run without touching the GPU or any real backend.
Useful for testing the UI wiring, queue coordination, and GPU-busy
blocking without needing a real model or training data.

Occupies the same job_manager slot as a real provider, so GPU-busy
guards (tagging refusing to run while training is active, and vice
versa) exercise the real code path.
"""

import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

from models import JobProgress, JobStatus, StartJobRequest
from providers.base import TrainingProvider


# Pretend we support every architecture so the user can select "mock"
# from any model's backend dropdown.
_SUPPORTED_ARCHS = ["flux", "sdxl", "zimage", "anima", "wan22_14b", "ltx2"]


class MockProvider(TrainingProvider):
    """Fake training backend that yields synthetic progress ticks."""

    def __init__(self, tick_count: int = 50, tick_interval: float = 0.2):
        self._tick_count = tick_count
        self._tick_interval = tick_interval
        self._cancelled = False

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        return True, None

    async def generate_config(
        self, request: StartJobRequest, config_dir: str
    ) -> str:
        # Write a trivial marker file so config_dir usage matches real providers.
        path = Path(config_dir) / f"{request.output_name}.mock.txt"
        path.write_text(
            f"mock training run for {request.output_name}\n"
            f"base_model={request.base_model}\n",
            encoding="utf-8",
        )
        return str(path)

    async def start_training(
        self, request: StartJobRequest, config_path: str, gpu_id: int = 0
    ) -> AsyncGenerator[JobProgress, None]:
        job_id = request.output_name  # Caller overrides with real ID
        self._cancelled = False

        hp = request.hyperparameters
        total_steps = int(hp.get("steps", 500))
        total_epochs = int(hp.get("epochs", 20))
        base_lr = float(hp.get("lr", 1e-4))

        yield JobProgress(job_id=job_id, status=JobStatus.PREPARING)

        # Brief "preparing" delay so the UI actually shows the preparing state.
        await asyncio.sleep(self._tick_interval)

        step_increment = max(1, total_steps // self._tick_count)
        current = 0

        while current < total_steps:
            if self._cancelled:
                return

            current = min(total_steps, current + step_increment)
            frac = current / total_steps

            # Synthetic loss curve: gentle decay with noise.
            base_loss = 0.15 - frac * 0.08
            noise = (hash((job_id, current)) % 100 - 50) / 5000.0
            loss = round(base_loss + noise, 4)
            lr = round(base_lr * (1 - frac * 0.3), 8)
            eta = max(0, int((total_steps - current) * self._tick_interval / step_increment))

            yield JobProgress(
                job_id=job_id,
                status=JobStatus.TRAINING,
                current_step=current,
                total_steps=total_steps,
                current_epoch=int(frac * total_epochs) + 1,
                total_epochs=total_epochs,
                loss=loss,
                learning_rate=lr,
                eta_seconds=eta,
                log_lines=[f"[mock] step {current}/{total_steps}"],
            )

            await asyncio.sleep(self._tick_interval)

        yield JobProgress(
            job_id=job_id,
            status=JobStatus.COMPLETED,
            current_step=total_steps,
            total_steps=total_steps,
            current_epoch=total_epochs,
            total_epochs=total_epochs,
            log_lines=["[mock] training complete"],
        )

    async def cancel_training(self) -> None:
        self._cancelled = True

    def get_supported_models(self) -> list[dict]:
        # Mock supports every architecture; the frontend expresses "mock" as
        # an alternative backend on each model, so the ID list here is just
        # a friendly catalogue rather than a whitelist.
        return [
            {"id": f"mock-{arch}", "name": f"Mock ({arch})", "architecture": arch}
            for arch in _SUPPORTED_ARCHS
        ]
