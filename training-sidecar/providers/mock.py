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

from job_manager import predict_checkpoint_steps
from models import JobProgress, JobStatus, StartJobRequest
from providers.base import TrainingProvider


# Pretend we support every architecture so the user can select "mock"
# from any model's backend dropdown.
_SUPPORTED_ARCHS = [
    "flux",
    "sdxl",
    "zimage",
    "krea2",
    "qwenimage",
    "anima",
    "wan22_14b",
    "ltx2",
]


class MockProvider(TrainingProvider):
    """Fake training backend that yields synthetic progress ticks."""

    def __init__(self, tick_count: int = 50, tick_interval: float = 0.2):
        self._tick_count = tick_count
        self._tick_interval = tick_interval
        # Ids cancel_training() has been asked to stop, keyed the same way the
        # manager knows them — one entry per in-flight run, so cancelling one
        # run can't stop another.
        self._cancel_requested: set[str] = set()

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
        self,
        request: StartJobRequest,
        config_path: str,
        gpu_id: int = 0,
        job_id: Optional[str] = None,
    ) -> AsyncGenerator[JobProgress, None]:
        job_id = job_id or request.output_name  # Caller overrides with real ID
        # Drop the cancel request however the run ends, so a later run reusing
        # the id (or just the set itself) doesn't carry it forward.
        inner = self._run(request, job_id)
        try:
            async for progress in inner:
                yield progress
        finally:
            await inner.aclose()
            self._cancel_requested.discard(job_id)

    async def _run(
        self, request: StartJobRequest, job_id: str
    ) -> AsyncGenerator[JobProgress, None]:
        """The run itself — see `start_training`, which owns the cancel entry."""
        hp = request.hyperparameters
        total_steps = int(hp.get("steps", 500))
        total_epochs = int(hp.get("epochs", 20))
        base_lr = float(hp.get("lr", 1e-4))

        # Fake checkpoint saves at the predicted step positions, so the UI can
        # exercise both the predicted ticks and confirmed-save markers without
        # a real backend. Any not yet reached is emitted once the step crosses
        # it; the manager dedupes by step.
        # Feed the prediction the resolved step count — `predict_checkpoint_steps`
        # reads `steps` too, and returns [] when it's absent, so it must see the
        # same default `total_steps` resolved to above.
        pending_saves = sorted(
            predict_checkpoint_steps({**hp, "steps": total_steps})
        )

        # Two synthetic setup phases (latents, then text-encoder outputs), each
        # a determinate bar carrying an it/s rate + ETA — exercises the caching
        # progress bar, ETA, and the transient prep speed graph (including the
        # per-phase reset) before training starts, without a real backend.
        for phase_label, prep_total in (
            ("Caching latents", 24),
            ("Caching text-encoder outputs", 16),
        ):
            prep_current = 0
            while prep_current < prep_total:
                if job_id in self._cancel_requested:
                    return
                prep_current = min(prep_total, prep_current + 4)
                prep_noise = (
                    hash((job_id, prep_current, phase_label)) % 100 - 50
                ) / 1000.0
                prep_sec_per_it = round(0.4 + prep_noise, 2)
                prep_eta = max(0, int((prep_total - prep_current) * prep_sec_per_it))
                yield JobProgress(
                    job_id=job_id,
                    status=JobStatus.PREPARING,
                    current_step=prep_current,
                    total_steps=prep_total,
                    eta_seconds=prep_eta,
                    # Report it/s (not s/it) so the manager's rate inversion is
                    # exercised too.
                    speed=f"{round(1.0 / prep_sec_per_it, 2)} it/s",
                    phase=phase_label,
                    log_lines=[
                        f"[mock] {phase_label.lower()} {prep_current}/{prep_total}"
                    ],
                )
                await asyncio.sleep(self._tick_interval)

        step_increment = max(1, total_steps // self._tick_count)
        current = 0

        while current < total_steps:
            if job_id in self._cancel_requested:
                return

            current = min(total_steps, current + step_increment)
            frac = current / total_steps

            # Synthetic loss curve: gentle decay with noise.
            base_loss = 0.15 - frac * 0.08
            noise = (hash((job_id, current)) % 100 - 50) / 5000.0
            loss = round(base_loss + noise, 4)
            lr = round(base_lr * (1 - frac * 0.3), 8)
            eta = max(0, int((total_steps - current) * self._tick_interval / step_increment))

            # Synthetic speed (s/it): slow for the first ~16 steps (cold
            # caches) then a steady rate with light jitter — exercises the
            # speed graph and the settle-step trim it applies.
            speed_noise = (hash((job_id, current, "s")) % 100 - 50) / 1000.0
            sec_per_it = round(1.2 + max(0.0, 2.0 - current * 0.12) + speed_noise, 2)

            # Any predicted checkpoint the step has now reached is "written".
            newly_saved = [s for s in pending_saves if s <= current]
            pending_saves = [s for s in pending_saves if s > current]

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
                speed=f"{sec_per_it} s/it",
                saved_checkpoints=newly_saved,
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
            # Flush any remaining predicted saves (e.g. a final-step save the
            # loop's <= check didn't emit) so the confirmed set is complete.
            saved_checkpoints=pending_saves,
            log_lines=["[mock] training complete"],
        )

    async def cancel_training(self, job_id: str) -> None:
        """Flag `job_id` so its loop returns at the next tick.

        The flag is discarded when that run's generator finishes; an id with no
        run behind it never fires.
        """
        self._cancel_requested.add(job_id)

    def get_supported_models(self) -> list[dict]:
        # Mock supports every architecture; the frontend expresses "mock" as
        # an alternative backend on each model, so the ID list here is just
        # a friendly catalogue rather than a whitelist.
        return [
            {"id": f"mock-{arch}", "name": f"Mock ({arch})", "architecture": arch}
            for arch in _SUPPORTED_ARCHS
        ]
