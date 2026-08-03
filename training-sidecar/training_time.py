"""Cumulative training-time markers that survive a stop → resume.

Neither sd-scripts nor ai-toolkit reports a cumulative, resume-aware "time
actually spent training" figure — their tqdm bars only expose a per-process
`elapsed<remaining` bracket that resets to zero whenever a run is resumed from
a saved state (and covers only the training loop, not caching/loading). So the
JobManager accumulates active-training wall-time itself (summing the gaps
between TRAINING-status progress ticks) and, so that figure carries across a
stop → resume, drops a small marker file next to the trainer's saved state.
When a later run resumes from that state, the marker is read back to seed the
accumulator instead of starting the training clock at zero.

Marker placement follows a provider's `time_marker_policy` (see
`providers/base.py`), because backends persist state differently:

- **"per-state-dir"** (kohya / sd-scripts lineage) writes a *fresh directory
  per checkpoint* — `{output_name}-step{N:08d}-state/`,
  `{output_name}-{epoch:06d}-state/`, and a final `{output_name}-state/`, all
  under `output_dir` (library/checkpoint_io.py STEP_STATE_NAME /
  EPOCH_STATE_NAME / LAST_STATE_NAME). Each is an independent snapshot, so we
  write the marker once per new state dir, capturing the training time *as of
  that checkpoint* — a run resumed from it then continues from exactly that
  figure.

- **"single-root"** (ai-toolkit) keeps a *single evolving* `optimizer.pt` in
  `save_root = {output_path}/{output_name}/` (BaseSDTrainProcess), overwritten
  on every save and auto-loaded on the next same-folder run. There's only ever
  one state, so we overwrite one marker there with the latest training time.

Every filesystem operation here is best-effort: a marker that can't be written
or read just means a future resume starts its training clock fresh, which is a
cosmetic regression, never a training failure.
"""

import json
from pathlib import Path
from typing import Optional

MARKER_NAME = "img-tagger-training-time.json"

# Fallback map from a persisted provider name to its `time_marker_policy`,
# for the lazy accumulator-reseed path (see job_manager._accumulate_progress)
# where only the provider string — not the provider object — is at hand.
# Anything absent here (including "ai-toolkit") defaults to "single-root",
# same as `TrainingProvider.time_marker_policy`'s own default. Kept here
# rather than on each provider class since this is the one place that needs
# to map a *name* back to a policy.
PROVIDER_MARKER_POLICY_FALLBACK: dict[str, str] = {
    "kohya": "per-state-dir",
    "musubi": "per-state-dir",
}


def marker_policy_for_provider_name(provider_name: str) -> str:
    """The `time_marker_policy` for a persisted provider name.

    Used only where a live provider object isn't available (the lazy
    accumulator reseed); the eager path resolves the policy straight off the
    provider instance instead.
    """
    return PROVIDER_MARKER_POLICY_FALLBACK.get(provider_name, "single-root")


def _read_marker(path: Path) -> Optional[float]:
    """Return the training-seconds stored in a marker file, or None."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        value = float(data.get("training_seconds", 0))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None
    return value if value >= 0 else None


def _write_marker(
    state_dir: Path, training_seconds: float, step: int, job_id: str
) -> None:
    try:
        payload = {
            "training_seconds": round(float(training_seconds), 3),
            "step": int(step),
            "job_id": job_id,
        }
        (state_dir / MARKER_NAME).write_text(
            json.dumps(payload), encoding="utf-8"
        )
    except (OSError, ValueError, TypeError):
        # Best-effort — a missing marker only costs a fresh clock on resume.
        pass


def _state_dir_step(dir_name: str, output_name: str) -> Optional[int]:
    """Parse the training step encoded in a kohya state-dir name, or None.

    sd-scripts names step-based states `{output_name}-step{N:08d}-state` and
    epoch-based ones `{output_name}-{epoch:06d}-state`, with a suffix-less final
    `{output_name}-state` (library/checkpoint_io.py). Only the step form carries
    a step we can look up in the ledger; the epoch and final forms return None
    (their marker falls back to the latest training-seconds).
    """
    middle = dir_name
    if middle.startswith(output_name):
        middle = middle[len(output_name) :]
    middle = middle.strip("-")
    if middle.endswith("-state"):
        middle = middle[: -len("-state")]
    middle = middle.strip("-")
    if middle.startswith("step"):
        digits = middle[len("step") :]
        if digits.isdigit():
            return int(digits)
    return None


def read_carryforward_seconds(resume_state: Optional[str]) -> float:
    """Training-seconds to continue from, given a user-selected resume path.

    `resume_state` may point at a state directory (kohya's `*-state`, or
    ai-toolkit's `save_root`) or at a file inside one — so we check the dir
    itself and, when a file was given, its parent. Returns 0.0 when there's
    nothing to carry (no path, no marker, unreadable) so a resume without a
    prior marker simply starts its training clock fresh.
    """
    if not resume_state:
        return 0.0
    p = Path(resume_state)
    marker = (p if p.is_dir() else p.parent) / MARKER_NAME
    value = _read_marker(marker)
    return value if value is not None else 0.0


def record_time_markers(
    policy: str,
    output_path: str,
    output_name: str,
    training_seconds: float,
    step: int,
    job_id: str,
    seconds_by_step: Optional[dict] = None,
) -> None:
    """Drop/refresh training-time markers next to the trainer's saved state.

    Called when a checkpoint is confirmed written, and again at run end. The
    write policy is the caller's `time_marker_policy` (see the module
    docstring and `providers/base.py`): "per-state-dir" gets a write-once
    snapshot per `*-state` dir; "single-root" gets one overwrite-latest marker
    in its single `save_root`.

    `seconds_by_step` maps a step to the training-seconds recorded when that
    step's checkpoint was saved. A "per-state-dir" `*-step{N}-state` dir isn't
    guaranteed to be on disk at the instant we parse its save log line
    (sd-scripts writes the safetensors first, then the state dir), so we may
    only find it on a later scan — looking its value up by the step *encoded
    in the dir name*, rather than using the current (by-then larger) total,
    keeps the marker correct for the checkpoint it belongs to. Falls back to
    `training_seconds` for dirs whose step isn't in the ledger (epoch/final
    states).
    """
    ledger = seconds_by_step or {}
    try:
        out = Path(output_path)
    except (TypeError, ValueError):
        return

    if policy == "per-state-dir":
        # Snapshot into each state dir that doesn't yet carry a marker. Match by
        # plain string ops rather than a glob — `output_name` is user free text
        # and may contain glob metacharacters like `[v2]` (mirrors the reasoning
        # in providers/ai_toolkit_ui._scan_checkpoints).
        if not out.is_dir():
            return
        try:
            entries = list(out.iterdir())
        except OSError:
            return
        for d in entries:
            if (
                d.is_dir()
                and d.name.startswith(output_name)
                and d.name.endswith("-state")
                and not (d / MARKER_NAME).exists()
            ):
                dir_step = _state_dir_step(d.name, output_name)
                value = ledger.get(dir_step, training_seconds)
                _write_marker(d, value, dir_step or step, job_id)
    else:
        # "single-root" (ai-toolkit, and anything else defaulting to it): one
        # evolving state at {output_path}/{output_name}; overwrite the marker
        # with the latest.
        root = out / output_name
        if root.is_dir():
            _write_marker(root, training_seconds, step, job_id)
