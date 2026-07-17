"""ai-toolkit training provider that drives the UI's HTTP API.

Instead of spawning `run.py` directly and scraping stderr (see
`ai_toolkit.py` for that approach — kept around as a template for the
future Kohya / Musubi providers), this provider talks to ai-toolkit's
own web server. Benefits:

  * structured progress (step / status / info / speed_string) via
    `GET /api/jobs?id=...` for the training loop itself
  * graceful cancel via `GET /api/jobs/<id>/stop`
  * loss / log / sample-image history surfaced by ai-toolkit's API
  * insulated from their SQLite schema — the HTTP API is the contract

The one gap is setup: bucketing and latent / text-embedding caching can run for
minutes while the job row sits on a single coarse `info` label, because those
loops only ever draw a tqdm bar to the worker's stdout. So for the pre-training
window — and only that window — we tail their `/api/jobs/<id>/log` route and
parse the bars, which is what gives the UI a real phase and a determinate
progress count instead of an indeterminate "Preparing…".

Requires the ai-toolkit UI server to be running, managed by
`ai_toolkit_server.AiToolkitServer`.
"""

from __future__ import annotations

import asyncio
import math
import os
import re
import sqlite3
import sys
import uuid
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Optional

import httpx

from ai_toolkit_server import AiToolkitServer
from models import JobProgress, JobStatus, StartJobRequest
from providers.ai_toolkit import (
    SUPPORTED_MODELS,
    _find_model,
    _first_resolution,
    _resolve_sample_sampler,
    _resolve_save_every_steps,
    _split_csv,
)
from providers.base import TrainingProvider

POLL_INTERVAL_SECONDS = 1.0
TERMINAL_STATUSES = {"completed", "stopped", "error"}

# ai-toolkit's cron worker writes this to the job row immediately before it
# spawns run.py detached, and nothing revisits it until the Python process gets
# far enough to construct UITrainer. So this one label also covers interpreter
# boot and the torch/diffusers imports — tens of seconds of apparent silence.
AITK_STARTING_INFO = "Starting job..."

# A tqdm bar as ai-toolkit renders it, e.g.
#   Caching latents to disk:  25%|██▌       | 3/12 [00:01<00:03,  2.50it/s]
# The desc prefix is optional — some bars are drawn without one.
TQDM_BAR_RE = re.compile(
    r"(?:(?P<desc>[^|\r\n]{0,80}?)\s*:\s*)?"
    r"\d{1,3}%\|[^|]*\|\s*(?P<current>\d+)/(?P<total>\d+)"
)

# tqdm descs we want to show under a friendlier name. Sourced from
# toolkit/dataloader_mixins.py; anything else falls back to the raw desc.
PREP_PHASE_BY_DESC = (
    ("caching latents", "Caching latents"),
    ("caching text embeddings", "Caching text embeddings"),
    ("caching clip vision", "Caching CLIP vision"),
    ("generating controls", "Generating controls"),
)

# How many consecutive non-bar log lines retire the last-seen setup bar. A live
# tqdm bar redraws constantly, so a run of plain lines means its phase is over
# and we should fall back to the row's own `info` label.
BAR_STALE_AFTER_LINES = 8

# After ai-toolkit flips a job to a terminal status, we wait for its
# subprocess PID to actually exit before releasing the GPU back to the
# queue. ai-toolkit's DiffusionTrainer.done_hook updates status BEFORE
# running wait_for_all_async / thread_pool.shutdown(wait=True), so the
# Python process can still be finalising (saving, sampling, async flushes)
# for a while after the DB says "completed". Handing the GPU to the next
# queued job during that window puts two training processes on the same
# GPU.
PID_EXIT_TIMEOUT_SECONDS = 180.0
PID_EXIT_POLL_INTERVAL = 0.5
# Fallback if the row has no pid (shouldn't happen in normal operation, but
# we don't want to hang the worker indefinitely on a weird DB state).
PID_UNKNOWN_SETTLE_SECONDS = 5.0


def _scan_checkpoints(output_path: str, output_name: str) -> set[str]:
    """Return the set of checkpoint safetensors written for this job so far.

    ai-toolkit's jobs API (`GET /api/jobs?id=`) surfaces only status / step /
    info / speed_string / pid — no save event or checkpoint list — so we watch
    the output directory instead. ai-toolkit writes intermediate LoRAs as
    `<name>_<step>.safetensors` (plus a final `<name>.safetensors`) flat under
    `<training_folder>/<name>/` (BaseTrainProcess sets
    `save_root = join(training_folder, name)`), so scan that subfolder — the
    job config's `name` is `output_name`, and `training_folder` is
    `output_path`.

    We iterate that directory non-recursively (so the ever-growing `samples/`
    subfolder isn't re-walked every second) and match with plain string ops
    rather than a glob — `output_name` is user-controlled free text and can
    contain glob metacharacters (e.g. `[v2]`) that would break `rglob`.
    """
    root = Path(output_path) / output_name
    if not root.exists():
        return set()
    try:
        return {
            str(p)
            for p in root.iterdir()
            if p.is_file()
            and p.name.startswith(output_name)
            and p.name.endswith(".safetensors")
        }
    except OSError:
        return set()


def _step_from_checkpoint_name(
    filename: str, output_name: str, fallback_step: int
) -> int:
    """Parse the training step encoded in a checkpoint filename.

    ai-toolkit writes intermediate saves as `<output_name>_<step>.safetensors`
    and a final save as `<output_name>.safetensors` (no step suffix). Returns
    the parsed step for intermediate saves, or `fallback_step` for the
    suffix-less final save — and for any name that doesn't parse cleanly, so an
    unexpected layout degrades to the polled step instead of crashing.
    """
    stem = filename
    if stem.endswith(".safetensors"):
        stem = stem[: -len(".safetensors")]
    if stem.startswith(output_name):
        stem = stem[len(output_name) :]
    # Intermediate saves separate the step with `_` (defensively also `-`).
    stem = stem.lstrip("_-")
    # Extract a trailing run of digits; fall back when there isn't one (the
    # no-suffix final save leaves stem empty).
    trailing = ""
    for ch in reversed(stem):
        if ch.isdigit():
            trailing = ch + trailing
        else:
            break
    return int(trailing) if trailing else fallback_step


def _steps_for_new_checkpoints(
    new_files: set[str], output_name: str, fallback_step: int
) -> list[int]:
    """Map newly-appeared checkpoint paths to their training steps.

    One entry per file so multiple saves that land within a single poll window
    are each recorded (the manager dedupes by step). Intermediate saves use the
    step parsed from their filename; the suffix-less final save (and any
    unparseable name) falls back to `fallback_step`.
    """
    return [
        _step_from_checkpoint_name(Path(p).name, output_name, fallback_step)
        for p in new_files
    ]


def _loss_log_path(output_path: str, output_name: str) -> Path:
    """Path to ai-toolkit's per-job metrics DB.

    ai-toolkit's UILogger writes `loss_log.db` to the trainer's save_root —
    `<training_folder>/<name>`, i.e. our `output_path/output_name` (the same
    dir we scan for checkpoints). We read it here rather than call ai-toolkit's
    `/api/jobs/<id>/loss` route: that route resolves the folder from the DB
    row's *unique* name under ai-toolkit's *own* training folder, which never
    matches the config `name` we save under — so it would look in the wrong
    place. Reading the file directly sidesteps that mismatch.
    """
    return Path(output_path) / output_name / "loss_log.db"


def _read_loss_metrics(db_path: Path) -> Optional[dict]:
    """Read the latest loss / learning_rate / iteration-rate from `loss_log.db`.

    Returns a dict with any of `loss`, `learning_rate`, `sec_per_it` that could
    be resolved, or None if the DB isn't there yet (logging hasn't started) or
    holds no rows. Best-effort: any SQLite error degrades to None so a
    momentarily-locked or half-written DB never breaks the poll loop.

    Metric keys mirror BaseSDTrainProcess: learning rate under `learning_rate`,
    loss under `loss/<name>` (typically `loss/loss`). The iteration rate is
    derived from the wall-time gap between the two most recent logged steps —
    ai-toolkit doesn't populate the job row's `speed_string` for ui_trainer.
    """
    if not db_path.exists():
        return None
    try:
        # Plain (read-write-capable) handle, like ai-toolkit's own /loss route:
        # a mode=ro connection can't attach to the writer's WAL shared-memory
        # index. We only ever issue SELECTs, and guard existence above so this
        # never creates the file.
        con = sqlite3.connect(str(db_path), timeout=1.0)
    except sqlite3.Error:
        return None
    try:
        con.execute("PRAGMA busy_timeout=1000;")
        keys = [r[0] for r in con.execute("SELECT key FROM metric_keys")]
        if not keys:
            return None

        result: dict = {}

        loss_key = next(
            (k for k in ("loss", "loss/loss") if k in keys),
            next((k for k in sorted(keys) if k.startswith("loss")), None),
        )
        if loss_key is not None:
            row = con.execute(
                "SELECT value_real FROM metrics WHERE key = ? "
                "ORDER BY step DESC LIMIT 1",
                (loss_key,),
            ).fetchone()
            if row and row[0] is not None:
                result["loss"] = float(row[0])

        if "learning_rate" in keys:
            row = con.execute(
                "SELECT value_real FROM metrics WHERE key = ? "
                "ORDER BY step DESC LIMIT 1",
                ("learning_rate",),
            ).fetchone()
            if row and row[0] is not None:
                result["learning_rate"] = float(row[0])

        # s/it from the last two logged steps' wall-times.
        steps = con.execute(
            "SELECT step, wall_time FROM steps ORDER BY step DESC LIMIT 2"
        ).fetchall()
        if len(steps) == 2:
            (late_step, late_t), (early_step, early_t) = steps
            if late_step > early_step and late_t > early_t:
                result["sec_per_it"] = (late_t - early_t) / (late_step - early_step)

        return result or None
    except sqlite3.Error:
        return None
    finally:
        con.close()


def _prep_phase_for_desc(desc: str) -> Optional[str]:
    """Friendly phase label for a tqdm desc, or the raw desc if unrecognised."""
    lowered = desc.lower()
    for needle, label in PREP_PHASE_BY_DESC:
        if needle in lowered:
            return label
    return desc or None


def _split_log_chunk(chunk: str) -> list[str]:
    """Split a raw log chunk into lines.

    tqdm redraws with carriage returns rather than newlines, so splitting on
    `\\n` alone would glue an entire bar's worth of updates into one enormous
    line. Treat `\\r` as a break too, exactly as the Kohya provider does.
    """
    return [line.strip() for line in re.split(r"[\r\n]+", chunk) if line.strip()]


async def _fetch_log_delta(
    client: httpx.AsyncClient, aitk_id: str, offset: Optional[int]
) -> tuple[list[str], Optional[int]]:
    """Pull newly-appended lines from ai-toolkit's per-job `log.txt`.

    Uses their `/api/jobs/<id>/log` route rather than reading the file: it
    resolves the job folder from the DB row's own name under ai-toolkit's
    training folder, which is where the log actually lives — not under our
    `output_path` (the same mismatch `_loss_log_path` documents). It also does
    byte-offset tailing, so each poll transfers only what's new.

    Returns (lines, new_offset). Best-effort — any failure yields no lines and
    leaves the offset untouched so a transient blip never breaks the poll loop.
    A new_offset of 0 means the worker hasn't written anything yet.
    """
    try:
        params = {} if offset is None else {"offset": offset}
        res = await client.get(f"/api/jobs/{aitk_id}/log", params=params)
        if res.status_code != 200:
            return [], offset
        body = res.json()
    except (httpx.HTTPError, ValueError):
        return [], offset
    # On `reset` the route ignores our offset and returns a fresh tail, which
    # is what we want anyway — either way `offset` is the new high-water mark.
    return _split_log_chunk(body.get("log") or ""), body.get("offset", offset)


def _extract_worker_error(log_path: Optional[Path], max_lines: int = 40) -> str:
    """Pull the tail of ai-toolkit's server log for a failed run.

    ai-toolkit's job row `info` only carries a one-line summary (e.g. the bare
    "[Errno 22] Invalid argument"); the real Python traceback goes to the
    worker's stdout, which we tee into `aitk-server.log`. When a job fails —
    especially early, before ai-toolkit writes its per-run log.txt — that tail
    is the only place the actual cause is visible, so fold it into the error we
    report. Best-effort: returns "" if the log can't be read.
    """
    if log_path is None or not log_path.exists():
        return ""
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return ""
    # Prefer the trailing WORKER/traceback lines — they carry the failure.
    tail = [ln for ln in lines if ln.strip()][-max_lines:]
    return "\n".join(tail).strip()


def _derive_epoch(step: int, total_steps: int, total_epochs: int) -> int:
    """Best-effort current epoch from the step counter.

    ai-toolkit is purely step-based — its job row carries no epoch — so we
    derive one the same way the UI relates the two: steps_per_epoch =
    ceil(total_steps / total_epochs), matching `predict_checkpoint_steps` and
    the client's calculated-steps selector (the config sends a consistent
    steps↔epochs pair). Returns 0 when it can't be resolved (no epoch count, or
    pre-training), which the UI reads as "no epoch info". Clamped to
    [1, total_epochs] so the final step doesn't overshoot to epoch N+1.
    """
    if total_epochs <= 0 or total_steps <= 0 or step <= 0:
        return 0
    steps_per_epoch = max(1, math.ceil(total_steps / total_epochs))
    return min(total_epochs, math.ceil(step / steps_per_epoch))


def _pid_alive(pid: int) -> bool:
    """Cross-platform: is a process with this PID currently running?"""
    if pid <= 0:
        return False
    if sys.platform == "win32":
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION, False, pid
        )
        if not handle:
            # Process gone (or access denied — treat the same way; we can't
            # distinguish, and "we can't see it" is as good as "it's gone"
            # for our purposes of deciding it's safe to release the GPU).
            return False
        try:
            exit_code = ctypes.c_ulong()
            ok = kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
            return ok != 0 and exit_code.value == STILL_ACTIVE
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


async def _wait_for_pid_exit(
    pid: Optional[int],
    timeout: float = PID_EXIT_TIMEOUT_SECONDS,
    poll_interval: float = PID_EXIT_POLL_INTERVAL,
) -> bool:
    """Wait for `pid` to exit. Returns True if it did, False on timeout.

    Falls back to a short settle delay when pid is missing/invalid.
    """
    if pid is None or pid <= 0:
        await asyncio.sleep(PID_UNKNOWN_SETTLE_SECONDS)
        return True
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        if not _pid_alive(pid):
            return True
        await asyncio.sleep(poll_interval)
    return False


class AiToolkitUiProvider(TrainingProvider):
    """ai-toolkit provider that uses the UI server's HTTP API."""

    def __init__(self, toolkit_path: str, server: AiToolkitServer):
        self._toolkit_path = Path(toolkit_path)
        self._server = server
        # Tracked so cancel_training can stop the in-flight job without
        # the caller having to thread the id back through.
        self._current_job_id: Optional[str] = None

    async def validate_environment(self) -> tuple[bool, Optional[str]]:
        ui_dir = self._toolkit_path / "ui"
        if not ui_dir.exists():
            return False, f"ai-toolkit UI not found at {ui_dir}"
        return True, None

    async def generate_config(
        self, request: StartJobRequest, config_dir: str
    ) -> str:
        """Return a stub path. The real config is sent to the API in
        start_training as JSON; ai-toolkit's worker writes it to disk
        itself. We don't need to materialise a YAML file."""
        return ""

    async def start_training(
        self, request: StartJobRequest, config_path: str, gpu_id: int = 0
    ) -> AsyncGenerator[JobProgress, None]:
        # The local job_id used by the parent JobManager is opaque to us;
        # ai-toolkit assigns its own id when we POST /api/jobs. We use
        # the parent id as the human-readable name and remember the
        # ai-toolkit id for polling/cancel.
        local_job_id = request.output_name

        # Accumulate a log tail as we progress through setup so the UI
        # can surface what the sidecar is actually doing during the
        # pre-training window (which can take a minute+ the first time
        # ai-toolkit's server cold-starts).
        log_tail: list[str] = []

        def _emit(label: str) -> JobProgress:
            log_tail.append(label)
            return JobProgress(
                job_id=local_job_id,
                status=JobStatus.PREPARING,
                log_lines=log_tail[-50:],
            )

        yield _emit("Starting ai-toolkit server...")
        await self._server.ensure_running()
        yield _emit("ai-toolkit server ready")

        config_dict = _build_config_dict(request, gpu_id)
        # Unique name — ai-toolkit's `name` column is a unique key, so a
        # second run with the same output_name would 409. Append a short
        # suffix; the user-facing label still comes from request.output_name.
        unique_name = f"{request.output_name}-{uuid.uuid4().hex[:8]}"

        async with httpx.AsyncClient(
            base_url=self._server.base_url, timeout=30.0
        ) as client:
            yield _emit(f"Submitting job to ai-toolkit (gpu {gpu_id})...")
            # 1. Create the job row
            create_res = await client.post(
                "/api/jobs",
                json={
                    "name": unique_name,
                    "gpu_ids": str(gpu_id),
                    "job_config": config_dict,
                },
            )
            if create_res.status_code >= 400:
                raise RuntimeError(
                    f"ai-toolkit /api/jobs returned {create_res.status_code}: "
                    f"{create_res.text[:300]}"
                )
            created = create_res.json()
            aitk_id: str = created["id"]
            self._current_job_id = aitk_id

            yield _emit(f"Job created: {aitk_id}")

            # 2. Queue the job
            start_res = await client.get(f"/api/jobs/{aitk_id}/start")
            if start_res.status_code >= 400:
                raise RuntimeError(
                    f"ai-toolkit /api/jobs/{aitk_id}/start returned "
                    f"{start_res.status_code}: {start_res.text[:300]}"
                )

            # 3. Make sure the queue itself is running. ai-toolkit's Queue
            # rows have an `is_running` flag; if it's false the worker
            # ignores queued jobs forever ("Queue Stopped" in their UI).
            # /api/queue/<gpu_ids>/start flips it to true (or creates the
            # row already-running).
            queue_res = await client.get(f"/api/queue/{gpu_id}/start")
            if queue_res.status_code >= 400:
                raise RuntimeError(
                    f"ai-toolkit /api/queue/{gpu_id}/start returned "
                    f"{queue_res.status_code}: {queue_res.text[:300]}"
                )

            yield _emit("Waiting for worker to pick up job...")

            # 4. Poll the job row until terminal. We keep the log_tail we
            # already built up during setup so the UI doesn't lose context
            # when the polling phase starts.
            total_steps = int(request.hyperparameters.get("steps", 0)) or 0
            # ai-toolkit runs by steps and reports no epoch; we derive one for
            # the UI from the effective epoch count the client sends.
            total_epochs = int(request.hyperparameters.get("epochs", 0) or 0)
            sample_paths: list[str] = []
            last_step = -1
            last_status_label = ""
            # Setup-phase state, recovered by tailing the worker's log.txt.
            # ai-toolkit's bucketing / latent / text-embedding caching only ever
            # emits a tqdm bar to stdout — the job row we poll stays pinned on a
            # single coarse `info` ("Loading dataset") for the minutes it runs.
            log_offset: Optional[int] = None
            prep_log: list[str] = []
            prep_bar: Optional[tuple[Optional[str], int, int]] = None
            lines_since_bar = 0
            # Confirmed-save detection via output-dir watching (the jobs API
            # exposes no save events). Seed with whatever's already on disk so
            # a resumed run doesn't count pre-existing files as fresh saves.
            seen_checkpoints: set[str] = _scan_checkpoints(
                request.output_path, request.output_name
            )
            # ai-toolkit's UILogger writes per-step loss/lr here once training
            # begins (we enable it via logging.use_ui_logger in the config).
            loss_db_path = _loss_log_path(
                request.output_path, request.output_name
            )

            while True:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                res = await client.get("/api/jobs", params={"id": aitk_id})
                if res.status_code != 200:
                    # Transient — keep polling.
                    continue
                row = res.json()
                if row is None:
                    # Job vanished (deleted out from under us).
                    yield JobProgress(
                        job_id=local_job_id,
                        status=JobStatus.FAILED,
                        error="ai-toolkit job row disappeared",
                    )
                    break

                aitk_status: str = row.get("status", "")
                step: int = row.get("step", 0) or 0
                info: str = row.get("info", "") or ""
                speed: str = row.get("speed_string", "") or ""

                if info and info != last_status_label:
                    log_tail.append(info)
                    del log_tail[:-50]
                    last_status_label = info

                # ai-toolkit's `info` is a coarse phase label: "Loading model",
                # "Loading dataset" (one label covering bucketing + latent and
                # text-embedding caching, which can run for minutes — the setup
                # branch below refines it from the worker's tqdm bars), "Saving
                # model", "Generating images - x/y", or "Training" while steps
                # advance. Surface everything but the plain "Training" as the
                # structured `phase` so the UI shows a phase label the same way
                # the Kohya provider does; None while actively stepping.
                phase_label: Optional[str] = (
                    None if info in ("", "Training") else info
                )

                # ai-toolkit's `step` only starts moving once the training loop
                # proper is underway, so a "running" row with no step is still
                # setup (model load, quantize, bucketing, caching).
                in_setup = aitk_status in ("queued", "starting") or (
                    aitk_status == "running" and step <= 0
                )

                if in_setup:
                    new_lines, log_offset = await _fetch_log_delta(
                        client, aitk_id, log_offset
                    )
                    for line in new_lines:
                        bar = TQDM_BAR_RE.search(line)
                        if bar is None:
                            prep_log.append(line)
                            lines_since_bar += 1
                            if lines_since_bar > BAR_STALE_AFTER_LINES:
                                prep_bar = None
                            continue
                        desc = (bar.group("desc") or "").strip()
                        if desc and desc == request.output_name:
                            # The training loop's own bar — setup is over; let
                            # the row's step drive the UI from here.
                            # BaseSDTrainProcess passes desc=self.job.name, and
                            # the trainer reads its name from the *config* we
                            # send (output_name), not the DB row's unique_name.
                            prep_bar = None
                            continue
                        prep_bar = (
                            _prep_phase_for_desc(desc),
                            int(bar.group("current")),
                            int(bar.group("total")),
                        )
                        lines_since_bar = 0
                    del prep_log[:-50]

                    bar_phase, bar_current, bar_total = prep_bar or (None, 0, 0)
                    # A live caching bar is more specific than the row's coarse
                    # label, so it wins when we have one.
                    prep_phase = bar_phase or phase_label
                    if prep_phase == AITK_STARTING_INFO:
                        # Still on the label ai-toolkit wrote before spawning
                        # means the worker hasn't reached UITrainer (which
                        # overwrites it with "Starting"), so it's necessarily
                        # still booting Python. Say that instead of parroting a
                        # label that is stale by construction.
                        prep_phase = "Starting Python worker"

                    yield JobProgress(
                        job_id=local_job_id,
                        status=JobStatus.PREPARING,
                        current_step=bar_current,
                        total_steps=bar_total,
                        phase=prep_phase,
                        log_lines=(log_tail + prep_log)[-50:],
                    )
                elif aitk_status == "running":
                    # Watch the output dir for newly-written checkpoints. Any
                    # new file since the last poll is a confirmed save at the
                    # current step; the manager dedupes by step.
                    newly_saved: list[int] = []
                    current_files = _scan_checkpoints(
                        request.output_path, request.output_name
                    )
                    new_files = current_files - seen_checkpoints
                    if new_files:
                        # Attribute each new file to the step parsed from
                        # its own name — poll lag means `step` may have
                        # moved past the step the file was actually saved
                        # at, and several files can appear in one window.
                        newly_saved = _steps_for_new_checkpoints(
                            new_files, request.output_name, step
                        )
                        seen_checkpoints = current_files

                    if step != last_step or info != last_status_label or newly_saved:
                        last_step = step
                        # Prefer ai-toolkit's structured metrics DB; fall
                        # back to the (usually empty for ui_trainer)
                        # speed_string parse if it isn't readable yet.
                        loss, lr, eta, rate = _parse_speed_string(speed)
                        metrics = _read_loss_metrics(loss_db_path)
                        if metrics is not None:
                            loss = metrics.get("loss", loss)
                            lr = metrics.get("learning_rate", lr)
                            sec_per_it = metrics.get("sec_per_it")
                            if sec_per_it is not None:
                                rate = f"{sec_per_it:.2f}s/it"
                                if total_steps > 0:
                                    eta = int(sec_per_it * (total_steps - step))
                        yield JobProgress(
                            job_id=local_job_id,
                            status=JobStatus.TRAINING,
                            current_step=step,
                            total_steps=total_steps,
                            current_epoch=_derive_epoch(
                                step, total_steps, total_epochs
                            ),
                            total_epochs=total_epochs,
                            loss=loss,
                            learning_rate=lr,
                            eta_seconds=eta,
                            speed=rate,
                            phase=phase_label,
                            saved_checkpoints=newly_saved,
                            sample_image_paths=sample_paths,
                            log_lines=(log_tail + prep_log)[-50:],
                        )
                elif aitk_status in TERMINAL_STATUSES:
                    final_status = (
                        JobStatus.COMPLETED
                        if aitk_status == "completed"
                        else JobStatus.CANCELLED
                        if aitk_status == "stopped"
                        else JobStatus.FAILED
                    )

                    # Wait for ai-toolkit's Python subprocess to actually exit
                    # before yielding terminal — the DB status flips before
                    # shutdown finishes (see PID_EXIT_* notes above). Until
                    # that process is gone, it may still be touching the GPU.
                    pid = row.get("pid")
                    if pid and _pid_alive(int(pid)):
                        log_tail.append("Finalizing...")
                        del log_tail[:-50]
                        # Keep the job appearing active in the UI while we
                        # wait, with a clearly distinct "Finalizing" log
                        # line so it doesn't look frozen.
                        yield JobProgress(
                            job_id=local_job_id,
                            status=JobStatus.TRAINING,
                            current_step=step,
                            total_steps=total_steps,
                            current_epoch=_derive_epoch(
                                step, total_steps, total_epochs
                            ),
                            total_epochs=total_epochs,
                            log_lines=(log_tail + prep_log)[-50:],
                        )
                        exited = await _wait_for_pid_exit(int(pid))
                        if not exited:
                            print(
                                f"[ai-toolkit-ui] Warning: aitk job {aitk_id} "
                                f"pid {pid} did not exit within "
                                f"{PID_EXIT_TIMEOUT_SECONDS:.0f}s; releasing "
                                "GPU anyway"
                            )

                    # One last sweep before going terminal: ai-toolkit writes
                    # the final `<name>.safetensors` during finalisation, after
                    # the last "running" poll — without this the run always
                    # under-reports its save count by one.
                    final_saved: list[int] = []
                    current_files = _scan_checkpoints(
                        request.output_path, request.output_name
                    )
                    new_files = current_files - seen_checkpoints
                    if new_files:
                        # The final save has no step suffix; attribute it to
                        # total_steps when known (more reliable at completion
                        # than the last polled step), else the polled step.
                        fallback = total_steps if total_steps > 0 else step
                        final_saved = _steps_for_new_checkpoints(
                            new_files, request.output_name, fallback
                        )
                        seen_checkpoints = current_files

                    error_text: Optional[str] = None
                    if final_status == JobStatus.FAILED:
                        # `info` is only a one-line summary; fold in the server
                        # log tail so the real traceback reaches the UI instead
                        # of a bare "[Errno 22] Invalid argument".
                        error_text = info or "ai-toolkit job failed"
                        worker_tail = _extract_worker_error(self._server.log_path)
                        if worker_tail:
                            error_text = (
                                f"{error_text}\n\n"
                                f"--- ai-toolkit server log (tail) ---\n"
                                f"{worker_tail}"
                            )

                    yield JobProgress(
                        job_id=local_job_id,
                        status=final_status,
                        current_step=step,
                        total_steps=total_steps,
                        current_epoch=_derive_epoch(
                            step, total_steps, total_epochs
                        ),
                        total_epochs=total_epochs,
                        saved_checkpoints=final_saved,
                        error=error_text,
                        log_lines=(log_tail + prep_log)[-50:],
                    )
                    break

            self._current_job_id = None

    async def cancel_training(self) -> None:
        if not self._current_job_id:
            return
        try:
            async with httpx.AsyncClient(
                base_url=self._server.base_url, timeout=10.0
            ) as client:
                await client.get(f"/api/jobs/{self._current_job_id}/stop")
        except httpx.HTTPError as err:
            print(f"[ai-toolkit-ui] cancel failed: {err}")

    def get_supported_models(self) -> list[dict]:
        return [
            {"id": m["id"], "name": m["name"], "architecture": m["architecture"]}
            for m in SUPPORTED_MODELS
        ]


# ---------------------------------------------------------------------------
# Config builder (mirrors providers/ai_toolkit.py but emits ui_trainer)
# ---------------------------------------------------------------------------


def _build_config_dict(request: StartJobRequest, gpu_id: int = 0) -> dict:
    """Build the ai-toolkit job_config dict — same shape as the YAML the
    CLI provider emits, but with `process[0].type = ui_trainer` so
    UITrainer is selected and writes step/info to the DB.

    ai-toolkit's worker injects `sqlite_db_path` itself before spawning,
    so we don't need to set that here.
    """
    model_def = _find_model(request.base_model)
    if model_def is None:
        raise ValueError(f"Unknown model: {request.base_model}")

    hp = request.hyperparameters
    defaults = model_def["train_defaults"]

    return {
        "job": "extension",
        "config": {
            "name": request.output_name,
            "process": [
                {
                    "type": "ui_trainer",
                    "training_folder": request.output_path,
                    "device": f"cuda:{gpu_id}",
                    # Training-time RNG seed (torch/cuda/random), read by
                    # BaseTrainProcess.__init__ via
                    # get_conf('training_seed', ...) — a process-level key,
                    # sibling to network/save/datasets/train/model/sample
                    # below. Distinct from the sample block's own hardcoded
                    # seed=42 (that reproducibly walks sample images across
                    # saves; this is the actual training-loop seed). -1
                    # means "random" client-side, so only emit when the user
                    # picked a fixed value.
                    **(
                        {"training_seed": int(hp["seed"])}
                        if int(hp.get("seed", -1)) >= 0
                        else {}
                    ),
                    "network": {
                        "type": hp.get("network_type", "lora"),
                        "linear": hp.get("network_dim", 16),
                        "linear_alpha": hp.get("network_alpha", 16),
                        **(
                            {"dropout": hp.get("network_dropout")}
                            if hp.get("network_dropout", 0) > 0
                            else {}
                        ),
                        # LoKr factor (-1 = auto). Only meaningful for lokr, so
                        # only emit when the user overrode it on a lokr network.
                        **(
                            {"lokr_factor": hp["lokr_factor"]}
                            if hp.get("network_type") == "lokr"
                            and hp.get("lokr_factor", -1) != -1
                            else {}
                        ),
                        # Restrict LoRA to layers whose names contain any of
                        # these substrings (network_kwargs.only_if_contains).
                        **(
                            {
                                "network_kwargs": {
                                    "only_if_contains": _split_csv(
                                        hp.get("layer_targeting", "")
                                    )
                                }
                            }
                            if _split_csv(hp.get("layer_targeting", ""))
                            else {}
                        ),
                    },
                    "save": {
                        "dtype": "float16",
                        "save_every": _resolve_save_every_steps(
                            hp,
                            hp.get("epochs", 10),
                            hp.get("steps", defaults.get("steps", 2000)),
                        ),
                        "max_step_saves_to_keep": (
                            hp["max_saves_to_keep"]
                            if hp.get("max_saves_to_keep", 4) > 0
                            else 10_000
                        ),
                        "save_state": hp.get("save_state", False),
                    },
                    # Turn on ai-toolkit's SQLite metrics logger so it writes
                    # per-step loss/learning_rate to `<save_root>/loss_log.db`,
                    # which the provider reads back (ui_trainer leaves the job
                    # row's speed_string empty, so this is our only structured
                    # source). log_every=1 → a point every step for a smooth
                    # live curve; the JobManager downsamples centrally anyway.
                    "logging": {
                        "use_ui_logger": True,
                        "log_every": 1,
                    },
                    "datasets": [
                        {
                            "folder_path": ds.path,
                            "caption_ext": "txt",
                            # Per-folder augmentation, sourced from the UI's
                            # folder-level settings (toolkit/config_modules.py
                            # DatasetConfig). Previously hardcoded here — note
                            # caption_dropout_rate now defaults to 0 (disabled)
                            # rather than the old hardcoded 0.05.
                            "caption_dropout_rate": ds.caption_dropout_rate,
                            "shuffle_tokens": ds.caption_shuffling,
                            "cache_latents_to_disk": True,
                            "resolution": hp.get(
                                "resolution", defaults.get("resolution", [1024])
                            ),
                            "num_repeats": ds.num_repeats,
                            "keep_tokens": ds.keep_tokens,
                            "network_weight": ds.lora_weight,
                            "is_reg": ds.is_regularization,
                            "flip_x": ds.flip_augment,
                            "flip_y": ds.flip_v_augment,
                        }
                        for ds in request.datasets
                    ],
                    "train": {
                        "batch_size": hp.get("batch_size", 1),
                        "steps": hp.get("steps", defaults.get("steps", 2000)),
                        # Force start_step=0 (unless the user explicitly
                        # opted into resume). Without this, ai-toolkit
                        # auto-loads training_info.step from any existing
                        # safetensors in the output dir — so a re-run with
                        # the same output_name silently inherits the prior
                        # run's step counter, often skipping training
                        # entirely (range(prev_step, new_steps) → empty).
                        "start_step": 0
                        if not hp.get("resume_state")
                        else None,
                        "gradient_accumulation_steps": hp.get(
                            "gradient_accumulation_steps", 1
                        ),
                        "train_unet": True,
                        "train_text_encoder": hp.get("train_text_encoder", False),
                        "gradient_checkpointing": True,
                        "noise_scheduler": defaults.get("noise_scheduler", "flowmatch"),
                        "optimizer": hp.get(
                            "optimizer", defaults.get("optimizer", "adamw8bit")
                        ),
                        "lr": hp.get("lr", defaults.get("lr", 1e-4)),
                        **(
                            {"lr_unet": hp["backbone_lr"]}
                            if hp.get("backbone_lr", 0) > 0
                            else {}
                        ),
                        **(
                            {"lr_text_encoder": hp["text_encoder_lr"]}
                            if hp.get("text_encoder_lr", 0) > 0
                            else {}
                        ),
                        "dtype": hp.get(
                            "mixed_precision", defaults.get("dtype", "bf16")
                        ),
                        "max_grad_norm": hp.get("max_grad_norm", 1.0),
                        **(
                            {
                                "ema_config": {
                                    "use_ema": True,
                                    "ema_decay": hp.get("ema_decay", 0.99),
                                }
                            }
                            if hp.get("ema", False)
                            else {}
                        ),
                        "loss_type": hp.get("loss_type", "mse"),
                        "timestep_type": hp.get("timestep_type", "sigmoid"),
                        "timestep_bias": hp.get("timestep_bias", "balanced"),
                        # Bias training toward subject content vs style.
                        "content_or_style": hp.get("content_or_style", "balanced"),
                        # Differential output preservation — only emit the
                        # multiplier/class when DOP itself is enabled.
                        **(
                            {
                                "diff_output_preservation": True,
                                "diff_output_preservation_multiplier": hp.get(
                                    "diff_output_preservation_multiplier", 1.0
                                ),
                                "diff_output_preservation_class": hp.get(
                                    "diff_output_preservation_class", ""
                                ),
                            }
                            if hp.get("diff_output_preservation", False)
                            else {}
                        ),
                        "cache_text_embeddings": hp.get(
                            "cache_text_embeddings", False
                        ),
                        "unload_text_encoder": hp.get("unload_text_encoder", False),
                        **(
                            {"resume_from_checkpoint": hp.get("resume_state")}
                            if hp.get("resume_state")
                            else {}
                        ),
                    },
                    "model": {
                        "name_or_path": hp.get(
                            "model_path", model_def["model_path"]
                        ),
                        **model_def["config"],
                        "quantize": hp.get(
                            "transformer_quantization", "float8"
                        ) == "float8",
                        "quantize_te": hp.get(
                            "text_encoder_quantization", "float8"
                        ) == "float8",
                        # Low-VRAM mode (ModelConfig.low_vram).
                        "low_vram": hp.get("low_vram", False),
                    },
                    **(
                        {
                            "sample": {
                                "sampler": _resolve_sample_sampler(hp, defaults),
                                "sample_every": hp.get(
                                    "sample_every_n_steps", 250
                                ),
                                "width": _first_resolution(hp, defaults),
                                "height": _first_resolution(hp, defaults),
                                "prompts": request.sample_prompts,
                                "seed": 42,
                                "walk_seed": True,
                                "guidance_scale": hp.get(
                                    "guidance_scale",
                                    defaults.get("guidance_scale", 4),
                                ),
                                "sample_steps": hp.get(
                                    "sample_steps",
                                    defaults.get("sample_steps", 20),
                                ),
                            },
                        }
                        if request.sample_prompts
                        else {}
                    ),
                }
            ],
            "meta": {"name": request.output_name, "version": "1.0"},
        },
    }


def _parse_speed_string(
    s: str,
) -> tuple[Optional[float], Optional[float], Optional[int], Optional[str]]:
    """Pick out loss / lr / eta / rate from ai-toolkit's `speed_string` field
    if present. Format varies — best-effort parse, returns None where
    unrecognised. Don't rely on these being populated.

    The rate is returned as the raw matched token (e.g. "2.30it/s") so the
    JobManager can normalise it to s/it the same way it does for other
    providers; None when no it/s or s/it token is present."""
    import re

    if not s:
        return None, None, None, None
    loss_m = re.search(r"loss:\s*([\d.eE+-]+)", s)
    lr_m = re.search(r"lr:\s*([\d.eE+-]+)", s)
    eta_m = re.search(r"(?:eta|ETA)[:\s]+(\d+)", s)
    rate_m = re.search(r"[\d.]+\s*(?:it/s|s/it)", s, re.IGNORECASE)
    return (
        float(loss_m.group(1)) if loss_m else None,
        float(lr_m.group(1)) if lr_m else None,
        int(eta_m.group(1)) if eta_m else None,
        rate_m.group(0) if rate_m else None,
    )
