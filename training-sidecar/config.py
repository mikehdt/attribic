"""Configuration loading for the training sidecar."""

import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class WorkerConfig:
    """Per-worker settings. Each worker pulls jobs from the shared queue and
    runs them on the assigned GPU. One worker = one GPU slot."""

    gpu_id: int = 0


@dataclass
class SidecarConfig:
    """Configuration for the training sidecar server."""

    port: int = 9733
    host: str = "127.0.0.1"
    # Port for ai-toolkit's bundled UI/API server (see ai_toolkit_server.py).
    aitk_port: int = 8675
    app_root: Path = field(default_factory=lambda: Path.cwd())
    # Everything the training system writes — jobs, saved projects, the PID
    # file, backend logs. Anchored to the configured projects folder; see
    # `src/app/services/training/training-root.ts` for the Node-side twin.
    training_dir: Path = field(default_factory=lambda: Path.cwd() / ".training")
    backends: dict[str, str] = field(default_factory=dict)
    # Default: a single worker on GPU 0. Multi-GPU users can add a second
    # entry (e.g. `{gpu_id: 1}`) in config.json under `sidecarWorkers`.
    workers: list[WorkerConfig] = field(
        default_factory=lambda: [WorkerConfig(gpu_id=0)]
    )

    def __post_init__(self):
        # Ensure training directory exists
        self.training_dir.mkdir(parents=True, exist_ok=True)
        (self.training_dir / "jobs").mkdir(exist_ok=True)


def load_config(app_root: Optional[Path] = None) -> SidecarConfig:
    """Load configuration from the app's config.json."""
    if app_root is None:
        # Default: assume we're in training-sidecar/, app root is parent
        app_root = Path(__file__).parent.parent

    config_path = app_root / "config.json"
    port = 9733
    aitk_port = 8675
    backends: dict[str, str] = {}
    workers: list[WorkerConfig] = [WorkerConfig(gpu_id=0)]
    projects_folder: Optional[Path] = None

    if config_path.exists():
        try:
            with open(config_path, "r") as f:
                data = json.load(f)

            # The training root hangs off the projects folder so runs sit
            # next to the datasets they were trained on.
            raw_projects = data.get("projectsFolder")
            if isinstance(raw_projects, str) and raw_projects.strip():
                projects_folder = Path(raw_projects)

            # Read training backend paths
            raw_backends = data.get("trainingBackends", {})
            for key, value in raw_backends.items():
                if isinstance(value, str) and Path(value).exists():
                    backends[key] = value

            port = data.get("sidecarPort", 9733)
            aitk_port = data.get("aiToolkitPort", 8675)

            # Optional: per-worker GPU assignments. Shape in config.json:
            #   "sidecarWorkers": [{"gpuId": 0}, {"gpuId": 1}]
            raw_workers = data.get("sidecarWorkers")
            if isinstance(raw_workers, list) and raw_workers:
                parsed: list[WorkerConfig] = []
                for entry in raw_workers:
                    if isinstance(entry, dict):
                        gpu = entry.get("gpuId", entry.get("gpu_id", 0))
                        try:
                            parsed.append(WorkerConfig(gpu_id=int(gpu)))
                        except (TypeError, ValueError):
                            continue
                if parsed:
                    workers = parsed
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: Failed to read config.json: {e}", file=sys.stderr)

    return SidecarConfig(
        port=port,
        aitk_port=aitk_port,
        app_root=app_root,
        training_dir=(projects_folder or app_root) / ".training",
        backends=backends,
        workers=workers,
    )
