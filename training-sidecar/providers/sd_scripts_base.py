"""Shared machinery for sd-scripts-lineage training backends.

kohya-ss/sd-scripts and musubi-tuner descend from the same codebase, so they
speak the same log grammar (tqdm bars on stderr, `avr_loss=` in the postfix,
`epoch N/M` between epochs, `saving checkpoint: …`), launch the same way
(`accelerate launch <script> …`), and write the same `-state` resume dirs.

Everything that follows from that lineage lives here: the log patterns, the
`\\r`-aware stream reader, the training-loop state machine (sampling pauses,
save detection, sample claiming, terminal handling), the tree-kill cancel, and
the small CLI/TOML formatting helpers. A concrete backend subclasses
`SdScriptsProvider` and supplies its catalogue, its config file, and
`_train_command()`; anything where the two backends genuinely differ is a
method or class attribute here rather than a copy-paste site.
"""

import asyncio
import os
import re
import shlex
import signal
import sys
import time
from abc import abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from composed_captions import compose_folder, extension_for_job
from models import (
    JobProgress,
    JobStatus,
    SampleImage,
    SampleProgress,
    StartJobRequest,
)
from providers.base import TrainingProvider
from sample_archive import collect_new_samples

# sd-scripts' main training bar looks like:
#   steps:   5%|▌         | 150/3000 [00:30<09:30,  2.30it/s, avr_loss=0.0912]
# The step count / elapsed<remaining / postfix are shared with ai-toolkit, but
# the loss key is `avr_loss=` rather than `loss:` and there's no lr in the bar.
TQDM_PATTERN = re.compile(
    r"(\d+)/(\d+)\s+"  # current/total steps
    r"\[([^\]]+)\]\s*"  # elapsed<remaining
    r"(.*)"  # postfix (avr_loss, it/s, etc.)
)
LOSS_PATTERN = re.compile(r"avr_loss[=:]\s*([\d.eE+-]+)")
ETA_PATTERN = re.compile(r"<(\d+):(\d+):?(\d*)")
# tqdm's iteration rate, e.g. "2.30it/s" or "23.01s/it" (slow steps invert it).
RATE_PATTERN = re.compile(r"([\d.]+)\s*(it/s|s/it)")
# sd-scripts prints "epoch 1/10" between epochs.
EPOCH_PATTERN = re.compile(r"epoch\s+(\d+)\s*/\s*(\d+)")

# Activity label for the sampling pause. The UI matches it (isSamplingPhase) to
# rename the in-flight samples row and freeze its countdowns, so it's set from
# one place — both where sampling is detected and where a frozen training-bar
# redraw has to preserve it.
SAMPLING_PHASE = "Generating samples"

# The line that opens a sampling pause, carrying the step it fired at:
#   "generating sample images at step / サンプル画像生成 ステップ: 250"  (sd-scripts)
#   "Generating sample images at step 250"                              (Anima)
# `\D*` spans the Japanese half of the localised variant.
SAMPLE_ANNOUNCE_PATTERN = re.compile(
    r"generating sample images at step\D*(\d+)", re.IGNORECASE
)

# How often the sampler's own tqdm bar may trigger a sample scan during a
# pause. A backstop only — each image is claimed by the scan on the following
# `prompt:` line, which lands the moment sd-scripts has finished writing it — so
# this just bounds the cost of the bar's ~10/s redraws to one directory listing
# a second, for the cases that line never comes (the event's last image).
SAMPLE_SCAN_INTERVAL_S = 1.0

# sd-scripts writes samples as
#   {output_name}_{num_suffix}_{promptIdx:02d}_{timestamp}{_seed}.png
# where num_suffix is `e%06d` (epoch cadence) or `%06d` (step cadence). We strip
# the exact `{output_name}_` prefix first (output_name may itself contain
# underscores), then match the remainder from the start: an optional `e` marks
# an epoch-cadence run, the six digits are the epoch or step, and the two-digit
# group is the prompt index.
SAMPLE_NAME_RE = re.compile(r"^(?:e(\d{6})|(\d{6}))_(\d{2})_")

# Leading "2026-07-13 21:20:00 " on sd-scripts' rich-formatted log lines. Only
# stripped for repeat comparison — the line itself keeps its timestamp.
# We pass --console_log_simple so sd-scripts' own logger no longer emits these,
# but accelerate and other libraries configure their own handlers, so keep it.
LOG_TIMESTAMP_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\s+")

# CSI escapes (colour, cursor moves) from tqdm and any library that still
# writes styled output. Stripped at read time so they never reach the UI, which
# renders lines as plain text, and never defeat repeat comparison.
ANSI_PATTERN = re.compile(r"\x1b\[[0-9;?]*[a-zA-Z]")

# Longest run of lines treated as one repeatable block by `_append_log_line`.
MAX_REPEAT_BLOCK = 4

# Lines that announce a save is under way. English-only by design: the
# sd-scripts fork logs these through `logger.info(f"saving checkpoint: …")` /
# `"saving state at epoch N"` / `"saving state at step N"` with no localised
# variant — the Japanese strings in that codebase live in comments and argparse
# help text, never in runtime log output. Class-level on the provider so a
# subclass with a different fork can extend or replace them.
SAVE_ANNOUNCE_PATTERNS = [
    # train_network.py: "saving checkpoint: {ckpt_file}"
    re.compile(r"saving checkpoint", re.IGNORECASE),
    re.compile(r"saving model", re.IGNORECASE),
    # library/checkpoint_io.py: "saving state at epoch {n}" / "at step {n}".
    # Emitted for --save_state runs alongside the checkpoint write.
    re.compile(r"saving state at", re.IGNORECASE),
]

# Lines that confirm the final save landed ("model saved." at the end of
# train_network.py's run).
SAVE_DONE_PATTERNS = [re.compile(r"model saved", re.IGNORECASE)]

# How long the merged-output loop waits on a line before checking whether the
# child is still alive. Generous: a single slow training step has been observed
# at 23 s/it, and a sampling pause can run minutes without printing. It exists
# purely so a child that dies while something else still holds its pipe open
# (a stuck accelerate worker, an antivirus filter) can't wedge the loop for
# ever waiting on an EOF that will never arrive.
STREAM_READ_TIMEOUT_S = 300

# Sentinel pushed onto the merged queue when one stream reaches EOF.
_EOF = object()


# --- Superseding a previous run under the same output name ---
#
# sd-scripts and musubi-tuner both write straight into the shared
# `--output_dir`/`--output_name` pair — no per-run subfolder, unlike
# ai-toolkit (see providers/ai_toolkit_ui._supersede_previous_checkpoints for
# that provider's version of this problem). A run that reuses a finished
# run's output name writes its checkpoints and `--save_state` dirs at exactly
# the paths the old run used, and the moment training reaches a step/epoch
# number the old run also saved at, that write clobbers the old file outright
# — no prompt, no backup.
#
# Unlike ai-toolkit, neither backend auto-resumes from whatever it finds lying
# around: a fresh run without an explicit `--resume` always starts from the
# base model regardless of what's sitting in `output_dir`. So this is scoped
# to *not destroying the user's files* — there's no silent-continuation risk
# to guard against here, unlike the ai-toolkit case this mirrors.

SUPERSEDED_DIRNAME = "_superseded"

# The part of a checkpoint/state-dir name that follows `{output_name}-`:
# either a plain zero-padded count (epoch) or `step` + a zero-padded count
# (step). Anchoring on this shape — rather than a bare `startswith` on
# `{output_name}-` — is what stops an output name that's a prefix of another,
# e.g. "demo" and "demo-v2", from matching each other's files: "demo-v2" would
# pass a naive `startswith("demo-")` check, but "v2" doesn't fit this shape so
# it's correctly left alone.
_RUN_SUFFIX_RE = re.compile(r"^(?:step)?\d+$")


def _matched_run_name(stem: str, output_name: str) -> Optional[str]:
    """The actual on-disk spelling of `output_name` that `stem` (a
    filename/dirname minus its known suffix) matches, or None if it doesn't
    match this run at all — per the shape `_RUN_SUFFIX_RE` documents.

    Matched case-insensitively, unconditionally (not just on Windows).
    NTFS — the platform this sidecar mainly runs on — already treats
    "demo.safetensors" and "Demo.safetensors" as the same file, so a
    case-sensitive comparison here would miss exactly the collision this
    machinery exists to prevent: relaunching a finished run "Demo" as
    "demo" would find nothing stale, and kohya's very first checkpoint
    write would then land on the old file in place, silently. Doing this
    unconditionally rather than gating it on `sys.platform == "win32"` also
    keeps it consistent with the in-flight name-collision check
    (validation.py's `.strip().lower()` comparison), which already treats
    output names as case-insensitive identities regardless of host OS —
    itself following `validate_output_name`'s reasoning that these names are
    validated as Windows-safe because the files they name commonly get
    copied to/from a Windows machine. The cost on a genuinely case-sensitive
    host (Linux) is a same-named-but-different-case run's files getting
    moved into `_superseded/` too eagerly; bounded, since that's a move, not
    a delete, and reported in the run's log prelude (see
    `_supersede_previous_run`) rather than done silently.

    Returned in its on-disk casing (not `output_name`'s), so a caller can
    tell the user the real name a case-variant match pulled in — e.g. that a
    stale "Demo.safetensors" is what a run named "demo" just superseded.
    """
    stem_lower = stem.lower()
    name_lower = output_name.lower()
    if stem_lower == name_lower:
        return stem
    prefix_len = len(output_name) + 1
    if stem_lower[:prefix_len] == f"{name_lower}-" and _RUN_SUFFIX_RE.match(
        stem[prefix_len:]
    ):
        return stem[: len(output_name)]
    return None


def _matches_run_name(stem: str, output_name: str) -> bool:
    """Whether `stem` names this run. See `_matched_run_name`."""
    return _matched_run_name(stem, output_name) is not None


def _is_run_checkpoint(name: str, output_name: str) -> bool:
    """Whether `name` is one of this run's saved safetensors checkpoints.

    Both backends share the same filename grammar (sd-scripts'
    library/checkpoint_io.py, musubi-tuner's utils/train_utils.py, verified
    against both checkouts): the final save is exactly
    `{output_name}.safetensors`, and every intermediate save is
    `{output_name}-<number>.safetensors` (zero-padded epoch, or `step` +
    zero-padded step) — see `_RUN_SUFFIX_RE`.
    """
    if not name.endswith(".safetensors"):
        return False
    return _matches_run_name(name[: -len(".safetensors")], output_name)


def _is_run_state_dir(name: str, output_name: str) -> bool:
    """Whether `name` is one of this run's `--save_state` resume directories.

    Same three shapes `training_time._state_dir_step` already parses:
    `{output_name}-state` (final), `{output_name}-NNNNNN-state` (epoch), and
    `{output_name}-stepNNNNNNNN-state` (step) — see that module's docstring
    for the source templates.
    """
    if not name.endswith("-state"):
        return False
    return _matches_run_name(name[: -len("-state")], output_name)


@dataclass
class _SupersedeScan:
    """What `_move_stale_run_files` found and managed to move.

    `dest` is set if and only if at least one entry actually landed there —
    never for an empty scan, and never for a total failure (see `failed`
    below), so a caller can treat `dest is not None` as "there is now a
    `_superseded/` folder with something in it" without also checking the
    counts.

    `failed` counts stale entries that were found but NOT moved, for any
    reason (locked by another process, permissions, path too long). It's
    tracked separately from the moved counts because a non-zero value means
    the caller must not stay quiet: those files are still sitting exactly
    where this run is about to write, so the overwrite this machinery exists
    to prevent is still live for them.
    """

    moved_ckpts: int = 0
    moved_states: int = 0
    dest: Optional[Path] = None
    failed: int = 0
    # Distinct on-disk spelling(s) of `output_name` among what actually
    # moved, case as found (see `_matched_run_name`) — differs from the
    # `output_name` a caller passed in only when the match was case-variant.
    # Empty when nothing moved.
    real_names: tuple[str, ...] = ()


def _move_stale_run_files(output_path: str, output_name: str) -> _SupersedeScan:
    """Move a previous run's checkpoints and state dirs into a stash folder.

    Scans `output_path` non-recursively — so the ever-growing `sample/`
    subfolder isn't touched; its PNGs are timestamped and never collide (see
    `_scan_sample_files`) — for files/dirs this output name owns, and moves
    them into `<output_path>/_superseded/<output_name>[-N]/`. Moved rather
    than deleted: they're the user's trained weights, and reusing an output
    name isn't necessarily a mistake — the same call ai-toolkit's version of
    this makes. `-N` disambiguates a name that has already been superseded
    once before (e.g. two runs of the same name finished back to back).

    Returns a `_SupersedeScan` — see its docstring for what `dest` and
    `failed` mean and how they combine (nothing found; total success;
    partial failure with some entries left behind; total failure with the
    stash dir removed again so an empty `_superseded/<name>/` isn't left
    lying around).
    """
    root = Path(output_path)
    if not root.exists():
        return _SupersedeScan()
    try:
        entries = list(root.iterdir())
    except OSError:
        return _SupersedeScan()

    stale_ckpts = [
        p
        for p in entries
        if p.is_file() and _is_run_checkpoint(p.name, output_name)
    ]
    stale_states = [
        p
        for p in entries
        if p.is_dir() and _is_run_state_dir(p.name, output_name)
    ]
    if not stale_ckpts and not stale_states:
        return _SupersedeScan()

    stash_dir = root / SUPERSEDED_DIRNAME / output_name
    attempt = 1
    while stash_dir.exists():
        attempt += 1
        stash_dir = root / SUPERSEDED_DIRNAME / f"{output_name}-{attempt}"
    try:
        stash_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        # Couldn't even create somewhere to put them — every stale entry
        # counts as failed so the caller warns instead of starting quiet.
        return _SupersedeScan(failed=len(stale_ckpts) + len(stale_states))

    # (path, stem-with-suffix-stripped, is-a-state-dir) for every stale
    # entry, so the move loop below is one pass regardless of kind.
    candidates = [
        (p, p.name[: -len(".safetensors")], False) for p in stale_ckpts
    ] + [(p, p.name[: -len("-state")], True) for p in stale_states]

    moved_ckpts = 0
    moved_states = 0
    failed = 0
    real_names: set[str] = set()
    for p, stem, is_state in candidates:
        try:
            p.rename(stash_dir / p.name)
        except OSError:
            # Leave what we can't move; the run still starts, but the
            # non-zero `failed` count this leaves behind is what turns into
            # a warning in `_supersede_previous_run` rather than silence.
            failed += 1
            continue
        if is_state:
            moved_states += 1
        else:
            moved_ckpts += 1
        matched = _matched_run_name(stem, output_name)
        if matched:
            real_names.add(matched)

    if moved_ckpts == 0 and moved_states == 0:
        # Total failure: nothing landed, so don't report a dest the caller
        # would read as "moved successfully", and don't leave an empty
        # `_superseded/<name>/` behind from the attempt.
        try:
            stash_dir.rmdir()
        except OSError:
            pass
        return _SupersedeScan(failed=failed)

    return _SupersedeScan(
        moved_ckpts=moved_ckpts,
        moved_states=moved_states,
        dest=stash_dir,
        failed=failed,
        real_names=tuple(sorted(real_names)),
    )


def _log_key(line: str) -> str:
    """Comparison key for repeat detection: the line minus timestamp/padding."""
    return LOG_TIMESTAMP_PATTERN.sub("", line).strip()


def _append_log_line(log_lines: list[str], line: str) -> None:
    """Append `line`, collapsing an immediately-repeated run of lines.

    sd-scripts emits some output once per DataLoader worker, and it isn't
    always a single line — an epoch rollover arrives as a two-line block:

        ... INFO  epoch is incremented.   dataset.py:464
        current_epoch: 76, epoch: 77
        ... INFO  epoch is incremented.   dataset.py:464
        current_epoch: 76, epoch: 77

    The lines alternate, so a "same as the previous line" check never fires.
    Instead, once a line lands, drop it (with its preceding k-1 lines) if the
    trailing k lines just repeat the k before them. Comparison ignores the
    timestamp so a repeat straddling a second boundary still collapses.
    """
    if log_lines and _log_key(log_lines[-1]) == _log_key(line):
        return

    log_lines.append(line)

    for k in range(2, MAX_REPEAT_BLOCK + 1):
        if len(log_lines) < 2 * k:
            break
        tail = [_log_key(entry) for entry in log_lines[-k:]]
        if tail == [_log_key(entry) for entry in log_lines[-2 * k : -k]]:
            del log_lines[-k:]
            return


# sd-scripts optimizer names differ in casing/spelling from the app's values.
_OPTIMIZER_MAP = {
    "adamw8bit": "AdamW8bit",
    "adamw": "AdamW",
    "adafactor": "Adafactor",
    "prodigy": "Prodigy",
    "lion": "Lion",
    "dadaptation": "DAdaptAdam",
}

# App save_format -> sd-scripts --save_precision.
_SAVE_PRECISION_MAP = {"fp16": "fp16", "bf16": "bf16", "fp32": "float"}


def _parse_eta_seconds(eta_str: str) -> Optional[int]:
    """Parse a tqdm ETA string like '15:30' or '1:15:30' into seconds."""
    match = ETA_PATTERN.search(eta_str)
    if not match:
        return None
    parts = [int(p) for p in match.groups() if p]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


def _sampling_phase(index: int, total: int) -> str:
    """The sampling activity label, carrying the image count when we have one.

    sd-scripts never says how many images an event will produce — but we wrote
    the prompt file, so the total is simply how many prompts we sent, and the
    index comes from counting the per-image `prompt:` blocks it echoes. Shaped
    like ai-toolkit's "Generating images - 3/4" so the client reads both
    backends through the one label formatter.
    """
    if index > 0 and total > 0:
        return f"{SAMPLING_PHASE} - {min(index, total)}/{total}"
    return SAMPLING_PHASE


async def _read_stream(stream: asyncio.StreamReader) -> AsyncGenerator[str, None]:
    r"""Read lines, splitting on tqdm's \r as well as \n.

    Cuts at whichever terminator comes FIRST. Preferring \n would swallow every
    \r-separated redraw sitting ahead of it in the same chunk: a bar that
    repaints faster than we drain the pipe (a fast sampler, or tqdm's closing
    double-repaint) then arrives as one merged line and only its first count is
    ever parsed — which is how a whole sampling event's progress disappears at
    once.
    """
    buffer = ""
    while True:
        chunk = await stream.read(256)
        if not chunk:
            break
        buffer += chunk.decode("utf-8", errors="replace")
        while True:
            cuts = [i for i in (buffer.find("\r"), buffer.find("\n")) if i >= 0]
            if not cuts:
                break
            cut = min(cuts)
            line, buffer = buffer[:cut], buffer[cut + 1 :]
            line = ANSI_PATTERN.sub("", line).strip()
            if line:
                yield line


def _merge_output(proc) -> tuple[asyncio.Queue, list[asyncio.Task]]:
    """Merge a process' stdout and stderr into one `(line, is_stderr)` queue.

    sd-scripts (via accelerate/tqdm) writes progress to stderr and most of its
    logging to stdout, so both have to be read — and read concurrently, since
    either pipe filling up blocks the child. Each reader pushes `_EOF` when its
    stream ends, so the consumer knows when both are done.
    """
    line_queue: asyncio.Queue = asyncio.Queue()

    async def drain(stream, is_stderr: bool):
        async for line in _read_stream(stream):
            await line_queue.put((line, is_stderr))
        await line_queue.put((_EOF, is_stderr))

    tasks = [
        asyncio.create_task(drain(proc.stdout, False)),
        asyncio.create_task(drain(proc.stderr, True)),
    ]
    return line_queue, tasks


@dataclass
class SubprocessRun:
    """State for one in-flight run, keyed by the manager's job id.

    The provider is a singleton, so anything per-run lives here rather than on
    the instance — otherwise cancelling one job would kill another's process,
    and two concurrent runs would clobber each other's cancelled flag.
    """

    process: Optional[asyncio.subprocess.Process] = None
    # Set by cancel_training() so the run loop can distinguish a
    # user-initiated stop from a genuine non-zero exit and stay quiet.
    cancelled: bool = False
    # Lines to head every log tail this run reports — currently what caption
    # composition did (see `_compose_captions`), which is the only thing the
    # user is told before the backend itself starts talking.
    log_prelude: list[str] = field(default_factory=list)


class SdScriptsProvider(TrainingProvider):
    """Shared machinery for sd-scripts-lineage backends.

    Subclasses supply the model catalogue, the config file, and the training
    command; everything from the spawn onwards is handled here.
    """

    # --- Overridable log grammar / behaviour knobs ---

    # Lines that open / confirm a save. See the module constants.
    save_announce_patterns: list[re.Pattern] = SAVE_ANNOUNCE_PATTERNS
    save_done_patterns: list[re.Pattern] = SAVE_DONE_PATTERNS
    # Activity label reported while any `save_announce_patterns` line is the
    # most recent thing the trainer said. Covers state saves too — they are
    # part of the same checkpointing pause.
    save_phase_label = "Saving checkpoint"

    # Prompt-line flag carrying CFG scale in the sample prompt file. sd-scripts
    # uses `--l` (from "guidance_scaLe"); musubi-tuner uses `--g`.
    sample_guidance_flag: str = "l"

    # Extra lines that open a sampling pause, beyond the sd-scripts grammar
    # matched inline in the run loop ("generating sample images…" and the
    # per-image "prompt:" echoes). A backend whose announce is worded
    # differently (Fizgig's "rendering previews (epoch N)…") lists it here;
    # searched against the lowercased line. A pattern with no step number is
    # fine — the pause is then anchored to the step the training bar froze on.
    sample_announce_patterns: list[re.Pattern] = []

    # sd-scripts echoes a "prompt:" block before each sample image, which is
    # what advances the per-image count in the sampling label. A backend that
    # renders silently between announce and files (Fizgig) sets this so the
    # count comes from its per-image sampler bar restarting instead.
    sample_bar_counts_images: bool = False

    # What this backend does with an image that has no caption file. sd-scripts
    # warns and trains an empty caption; musubi's caption-file filter drops the
    # image from the dataset instead. Only surfaces when the chosen half of a
    # hybrid caption is empty, which is the one case that leaves an image
    # without a composed caption (see `composed_captions`).
    no_caption_outcome: str = "will train without a caption"

    # How the training-time marker file is located for resume carry-forward.
    # Declared here so a backend that names its state dirs differently can say
    # so; consumed by the training-time accounting (see `training_time`).
    time_marker_policy: str = "per-state-dir"

    def __init__(self, scripts_path: str):
        self._scripts_path = Path(scripts_path)
        self._runs: dict[str, SubprocessRun] = {}
        # Notes queued during generate_config for this job's run-start log
        # prelude, read once when its run starts (see `_caption_prelude`).
        # Caption composition (`_compose_captions`) and superseding a reused
        # output name (`_supersede_previous_run`) both write here. Keyed by
        # job id because the provider is a singleton and two runs can be
        # composing/superseding at the same time.
        self._caption_notes: dict[str, list[str]] = {}

    # --- Caption composition ---

    def _compose_captions(
        self, request: StartJobRequest, job_id: str
    ) -> dict[int, str]:
        """Write this run's composed caption files for every hybrid dataset.

        Returns `{dataset index: caption_extension}` for the folders that got
        them — index-aligned with `request.datasets` and sparse, since a folder
        with no hybrid captions in it is left alone entirely. Subclasses write
        those extensions into their own dataset config; a folder missing from
        the mapping keeps the inherited `.txt`.

        Called from `generate_config` rather than the run itself because the
        config has to name the extension, and it is the same file the composed
        captions are written for.
        """
        if not job_id:
            return {}

        extensions: dict[int, str] = {}
        notes: list[str] = []
        for index, ds in enumerate(request.datasets):
            result = compose_folder(ds.path, ds.caption_emission, job_id)
            if result is None:
                continue
            extensions[index] = extension_for_job(job_id)
            if result.changed:
                notes.append(
                    f"Composed {result.changed} caption(s) in {ds.path} "
                    f"as {ds.caption_emission}"
                )
            # Not a failure — style training on bare captions is a real
            # workflow — but it changes what trains, so it is worth seeing
            # before the run rather than after.
            if result.emptied:
                notes.append(
                    f"Warning: {result.emptied} image(s) in {ds.path} have no "
                    f"{ds.caption_emission} half and {self.no_caption_outcome}"
                )

        if notes:
            self._caption_notes[job_id] = notes
        return extensions

    def _caption_prelude(self, job_id: str) -> list[str]:
        """This run's queued setup notes (captions, supersede), consumed once.

        Popped rather than read so a re-run under a recycled id can't inherit
        the previous run's notes, and so the dict doesn't grow for the life of
        the sidecar.
        """
        return self._caption_notes.pop(job_id, [])

    # --- Superseding a previous run under the same output name ---

    def _supersede_previous_run(
        self, request: StartJobRequest, job_id: str
    ) -> None:
        """Move a previous run's checkpoints/state dirs aside if reused.

        See the module-level comment above `SUPERSEDED_DIRNAME` for why this
        exists and how it differs from ai-toolkit's version of the same
        problem, and `_move_stale_run_files` for the scan/move itself.

        Skipped entirely when this run is itself resuming (`resume_state`
        set): the files it would move are exactly the ones the user pointed
        the run at, so touching them would undermine the very resume being
        asked for. Called from `generate_config`, same as `_compose_captions`
        — before this method runs, `output_dir` still holds whatever the last
        run under this name left behind.

        Queues a note onto the same per-job list `_compose_captions` writes
        to, so it surfaces in the same run-start log prelude (see
        `_caption_prelude`) rather than a second, separate one. A move
        failure (partial or total — see `_SupersedeScan.failed`) queues a
        "Warning: ..." note instead, in the same "surface it before the run
        rather than after" style `_compose_captions` uses for its own
        non-fatal warnings — silence would be wrong here, since it would
        mean the user's old weights are still sitting exactly where this run
        is about to write.
        """
        if request.hyperparameters.get("resume_state"):
            return

        scan = _move_stale_run_files(request.output_path, request.output_name)
        notes: list[str] = []

        if scan.dest is not None:
            parts = []
            if scan.moved_ckpts:
                parts.append(f"{scan.moved_ckpts} checkpoint file(s)")
            if scan.moved_states:
                parts.append(f"{scan.moved_states} resume-state folder(s)")
            rel_dest = scan.dest.relative_to(Path(request.output_path))
            # The match is case-insensitive (see `_matched_run_name`), so
            # what actually moved may be spelled differently on disk than
            # this run's own name — say so, or "moved from an earlier run of
            # 'demo'" reads as a claim that the old run was also called
            # exactly "demo" when it might have been "Demo".
            variants = [n for n in scan.real_names if n != request.output_name]
            spelling_note = (
                f" (found on disk as {', '.join(repr(v) for v in variants)})"
                if variants
                else ""
            )
            notes.append(
                f"Moved {' and '.join(parts)} from an earlier run of "
                f"'{request.output_name}'{spelling_note} into {rel_dest} so "
                "this run doesn't overwrite them"
            )

        if scan.failed:
            where = "the rest of them" if scan.dest is not None else "them"
            notes.append(
                f"Warning: found {scan.failed} checkpoint file(s)/"
                f"resume-state folder(s) from an earlier run of "
                f"'{request.output_name}' but could not move {where} out of "
                "the way (locked, permissions, or path too long) — this run "
                "may overwrite them"
            )

        if notes:
            self._caption_notes.setdefault(job_id, []).extend(notes)

    # --- Subclass hooks ---

    @abstractmethod
    def _train_command(
        self, request: StartJobRequest, config_path: str
    ) -> tuple[str, str, list[str], str]:
        """(python_exe, script_path, cli_args, cwd) for the accelerate launch."""
        ...

    async def _pre_train(
        self,
        job_id: str,
        request: StartJobRequest,
        config_path: str,
        gpu_id: int,
        run: SubprocessRun,
    ) -> AsyncGenerator[JobProgress, None]:
        """Setup phases to run before the training spawn.

        musubi-tuner caches latents and text-encoder outputs in separate
        processes before training proper; kohya does it inside the training
        script, so the default is no phases at all. Implementations drive
        `_run_phase_subprocess` and forward its PREPARING ticks.
        """
        return
        yield  # pragma: no cover — makes this an async generator

    # --- Run lifecycle ---

    async def start_training(
        self,
        request: StartJobRequest,
        config_path: str,
        gpu_id: int = 0,
        job_id: Optional[str] = None,
    ) -> AsyncGenerator[JobProgress, None]:
        # The manager passes its real id (and overwrites the one we set on each
        # yielded progress anyway); output_name is the standalone fallback.
        job_id = job_id or request.output_name

        # Register the run before yielding anything, so a cancel arriving at any
        # point during the run finds it — and drop it however this ends
        # (completion, failure, or the consumer abandoning the generator), so a
        # dead subprocess handle can't outlive its job.
        run = SubprocessRun()
        self._runs[job_id] = run
        inner = self._run(request, config_path, gpu_id, job_id, run)
        try:
            async for progress in inner:
                yield progress
        finally:
            await inner.aclose()
            self._runs.pop(job_id, None)
            # Normally consumed by `_run`; this covers a job cancelled between
            # generate_config and here, which never reaches that.
            self._caption_notes.pop(job_id, None)

    async def _run(
        self,
        request: StartJobRequest,
        config_path: str,
        gpu_id: int,
        job_id: str,
        run: SubprocessRun,
    ) -> AsyncGenerator[JobProgress, None]:
        """The run itself — see `start_training`, which owns `run`'s lifetime."""
        # What caption composition did, said once up front and then carried as
        # the head of every log tail this run produces — the empty-half warning
        # in particular explains a step count the user may be about to query.
        run.log_prelude = self._caption_prelude(job_id)
        if run.log_prelude:
            yield JobProgress(
                job_id=job_id,
                status=JobStatus.PREPARING,
                log_lines=list(run.log_prelude),
            )

        async for progress in self._pre_train(
            job_id, request, config_path, gpu_id, run
        ):
            yield progress

        # A cancel that landed before we got here has nothing to kill, so the
        # spawn must not happen at all — otherwise the run starts orphaned from
        # the job the manager has already reported as cancelled.
        if run.cancelled:
            return

        python_exe, script, cli_args, cwd = self._train_command(
            request, config_path
        )
        mixed_precision = request.hyperparameters.get("mixed_precision", "bf16")

        run.process = await self._spawn_accelerate(
            python_exe, script, cli_args, cwd, mixed_precision, gpu_id
        )

        yield JobProgress(job_id=job_id, status=JobStatus.PREPARING)

        # Hold a local handle: cancel_training() nulls run.process, and the
        # tail of the loop must still be able to await the exit code.
        async for progress in self._stream_training_progress(
            job_id, request, run, run.process
        ):
            yield progress

    def _subprocess_env(self, gpu_id: int) -> dict:
        return {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            # sd-scripts prints Japanese log strings. When stdout/stderr are
            # pipes (as here), Windows Python defaults to cp1252 and crashes
            # with UnicodeEncodeError before training starts. Force UTF-8 so
            # the child can emit those characters.
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
            "CUDA_VISIBLE_DEVICES": str(gpu_id),
        }

    async def _spawn_accelerate(
        self,
        python_exe: str,
        script: str,
        cli_args: list[str],
        cwd: str,
        mixed_precision: str,
        gpu_id: int,
    ) -> asyncio.subprocess.Process:
        """Launch `script` under accelerate with explicit single-GPU flags.

        We pass the launch flags rather than rely on a machine-level
        `accelerate config`, so a single-GPU run is deterministic regardless of
        the user's global accelerate defaults.
        """
        return await asyncio.create_subprocess_exec(
            python_exe,
            "-u",
            "-m",
            "accelerate.commands.launch",
            "--num_processes=1",
            "--num_machines=1",
            f"--mixed_precision={mixed_precision}",
            "--dynamo_backend=no",
            "--num_cpu_threads_per_process=1",
            script,
            *cli_args,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=self._subprocess_env(gpu_id),
        )

    # --- Sample discovery ---

    def _scan_sample_files(self, output_path: str, output_name: str) -> set[str]:
        """Return the sample PNGs written for this run so far.

        sd-scripts writes samples to `<output_dir>/sample/`, and since we pass
        `--output_dir=<output_path>` (the shared loras root) that folder is
        shared across every run — so we filter to this run's `{output_name}_`
        prefix. Iterated non-recursively; matched with plain string ops rather
        than a glob because `output_name` is user-controlled free text that can
        contain glob metacharacters.
        """
        sample_dir = Path(output_path) / "sample"
        if not sample_dir.exists():
            return set()
        prefix = f"{output_name}_"
        try:
            return {
                str(p)
                for p in sample_dir.iterdir()
                if p.is_file()
                and p.name.startswith(prefix)
                and p.suffix.lower() == ".png"
            }
        except OSError:
            return set()

    def _parse_sample(
        self, path: str, output_name: str
    ) -> Optional[SampleImage]:
        """Parse step/epoch/prompt-index out of a sample filename.

        Returns a SampleImage with a `sample/<file>` POSIX path relative to
        output_path, or None for a name that doesn't fit the grammar.
        """
        name = Path(path).name
        prefix = f"{output_name}_"
        if not name.startswith(prefix):
            return None
        match = SAMPLE_NAME_RE.match(name[len(prefix) :])
        if not match:
            return None
        epoch = int(match.group(1)) if match.group(1) else None
        # Epoch-cadence runs encode the epoch, not the step, so the step is
        # unknown.
        step = int(match.group(2)) if match.group(2) else 0
        prompt_index = int(match.group(3))
        return SampleImage(
            path=f"sample/{name}",
            step=step,
            epoch=epoch,
            prompt_index=prompt_index,
        )

    def _collect_new_samples(
        self,
        output_path: str,
        output_name: str,
        seen: set[str],
        samples: list[SampleImage],
        job_id: Optional[str] = None,
        require_settled: bool = True,
    ) -> None:
        """Claim freshly-written samples. See `sample_archive`."""
        collect_new_samples(
            scan=self._scan_sample_files,
            parse=self._parse_sample,
            output_path=output_path,
            output_name=output_name,
            seen=seen,
            samples=samples,
            job_id=job_id,
            require_settled=require_settled,
        )

    # --- Log classification ---

    def _preparing_phase_for(self, lower_line: str) -> Optional[str]:
        """Setup-phase label for a pre-training log line, or None.

        Latched by the run loop from the INFO/loader lines sd-scripts prints
        just before each setup tqdm bar.
        """
        if "caching latents" in lower_line:
            return "Caching latents"
        if "caching text encoder" in lower_line:
            return "Caching text-encoder outputs"
        if "loading" in lower_line and "safetensors" in lower_line:
            return "Loading model"
        return None

    def _is_save_announce(self, line: str) -> bool:
        return any(p.search(line) for p in self.save_announce_patterns)

    def _is_save_done(self, line: str) -> bool:
        return any(p.search(line) for p in self.save_done_patterns)

    def _housekeep_checkpoints(self, request: StartJobRequest) -> None:
        """Hook for checkpoint retention a backend can't do itself.

        Called by the run loop at each epoch rollover and once more after a
        clean exit. The default is a no-op: sd-scripts and musubi prune their
        own saves via --save_last_n_epochs/steps. Fizgig has no equivalent
        flag, so its provider overrides this to enforce max_saves_to_keep.
        """

    # --- The training-loop state machine ---

    async def _stream_training_progress(
        self,
        job_id: str,
        request: StartJobRequest,
        run: SubprocessRun,
        proc,
    ) -> AsyncGenerator[JobProgress, None]:
        """Read the trainer's merged output and yield JobProgress from it."""
        log_lines: list[str] = list(run.log_prelude)
        stderr_lines: list[str] = []
        # Sample collection: scan-diff `<output_path>/sample/` (shared across
        # runs) against a seen-set seeded now, so pre-existing files from
        # earlier runs are never claimed. sd-scripts never prints per-file
        # sample paths, so the directory is the only source.
        samples: list[SampleImage] = []
        seen_samples: set[str] = self._scan_sample_files(
            request.output_path, request.output_name
        )
        current_epoch = 0
        total_epochs = 0
        # Epoch number logged during a sampling pause, applied once the pause
        # ends — see the EPOCH_PATTERN branch in the run loop.
        pending_epoch: Optional[int] = None

        line_queue, drain_tasks = _merge_output(proc)

        training_started = False
        # True while sd-scripts is generating sample images. The sampler runs
        # its own tqdm bars (e.g. 20 diffusion steps per image) which would
        # otherwise be latched as the training bar via `training_started` and
        # briefly rewrite current/total steps to 20/20 — collapsing the UI's
        # charts. While set, only a bar that proves itself (avr_loss or the
        # "steps" desc prefix) is accepted, which also clears the flag.
        sampling_active = False
        # Step the current sampling pause was announced at. train_network.py does
        # `progress_bar.update(1); global_step += 1` and then samples immediately,
        # but tqdm only repaints every 0.1s — so the bar line for that step
        # usually arrives *during* the pause, and `unpause()` forces another
        # repaint on the way out. Anchoring on the announced step means those
        # catch-up repaints read as what they are; only a bar beyond it is
        # training actually resuming.
        sampling_step = 0
        # Last (current, total) read off the sampler's own diffusion bar, e.g.
        #   Sampling:  67%|██████▋   | 16/24 [00:13<00:07,  1.14it/s]
        # Kept so the ~10/s tqdm redraws only produce an event when the count
        # actually moves. Reset at the start of each sampling pause.
        last_sample_bar: Optional[tuple[int, int]] = None
        # Which image of the current sampling event is rendering, 1-based, and
        # how many the event will produce. sd-scripts reports neither — but the
        # total is just the prompt list we handed it, and the index is a count
        # of the `prompt:` blocks it echoes, one per image. Reset at the start
        # of each pause so every event counts from one.
        sample_image_index = 0
        sample_image_total = len(request.sample_prompts)
        # When the sampler's bar last triggered a sample scan. Bounds the cost
        # of scanning from inside the pause (see the sampler-bar branch below)
        # to roughly once per settle window rather than once per diffusion step.
        last_sample_scan = 0.0
        # Last training step counts seen, so the terminal COMPLETED event can
        # report the bar as full (N/N) rather than dropping back to 0/0.
        current_step = 0
        total_steps = 0
        # Last loss seen, so activity events between steps (saving/sampling)
        # keep showing it rather than blanking the value mid-save.
        last_loss: Optional[float] = None
        # Human-readable label for the current setup phase. Latched from the
        # INFO/loader lines sd-scripts prints just before each tqdm bar, so it
        # survives the rapid bar redraws that would otherwise scroll the header
        # out of any fixed-size log window.
        preparing_phase: Optional[str] = None
        eofs_seen = 0
        # Set when the child has exited but a pipe is still held open, so the
        # EOFs we're waiting on will never arrive.
        abandoned_pipes = False
        while eofs_seen < 2:
            try:
                item, is_stderr = await asyncio.wait_for(
                    line_queue.get(), timeout=STREAM_READ_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                # Nothing for a long while. If the child is gone, something
                # else is holding its pipes and no EOF is coming — stop
                # waiting. If it's still alive, it's just a slow step or a long
                # sampling pause; keep waiting.
                if proc.returncode is not None:
                    abandoned_pipes = True
                    break
                continue
            if item is _EOF:
                eofs_seen += 1
                continue
            line = item

            if is_stderr:
                stderr_lines.append(line)

            # Track which setup phase we're in so the caching/loading tqdm bars
            # can be labelled and shown with a determinate progress bar.
            phase_label = self._preparing_phase_for(line.lower())
            if phase_label:
                preparing_phase = phase_label

            epoch_match = EPOCH_PATTERN.search(line)
            if epoch_match:
                total_epochs = int(epoch_match.group(2))
                # By the time the next epoch line prints, the previous epoch's
                # checkpoint (if the cadence saved one) has fully landed —
                # the safe moment for provider-side retention.
                self._housekeep_checkpoints(request)
                if sampling_active:
                    # sd-scripts samples at the end of an epoch and the loop
                    # logs the *next* epoch immediately after — while the
                    # trainer is still finishing the pause. Hold the new number
                    # back so the reported epoch keeps naming the event being
                    # sampled (which is what its sample filenames encode, and
                    # what the UI matches the in-flight row against); every
                    # other counter is frozen through the pause anyway.
                    pending_epoch = int(epoch_match.group(1))
                else:
                    current_epoch = int(epoch_match.group(1))

            match = TQDM_PATTERN.search(line)
            # avr_loss and the it/s rate both sit *inside* the tqdm bracket, so
            # search the whole line rather than the post-bracket remainder.
            loss_match = LOSS_PATTERN.search(line) if match else None
            rate_match = RATE_PATTERN.search(line) if match else None

            # sd-scripts shows several tqdm bars (caching latents, caching TE
            # outputs, then the training loop). Only the training bar is
            # prefixed with "steps" and/or carries avr_loss — latch on that so
            # setup bars stay under the Preparing label. An anonymous bar
            # (no prefix, no loss) is only trusted mid-run when its total
            # matches the established step count: the sampler's own diffusion
            # bars (e.g. 13/20) would otherwise briefly rewrite current/total
            # steps and collapse the charts, even if the "generating sample"
            # log line that sets `sampling_active` was missed.
            bar_total = int(match.group(2)) if match else 0
            is_training_bar = bool(
                match
                and (
                    loss_match
                    or line.lower().startswith("steps")
                    or (
                        training_started
                        and not sampling_active
                        and (total_steps <= 0 or bar_total == total_steps)
                    )
                )
            )

            if match and is_training_bar:
                training_started = True
                new_step = int(match.group(1))
                # sd-scripts reprints the training bar throughout the sampling
                # pause — sometimes catching up to the step sampling was
                # announced at. Only a bar past that step is training resuming;
                # without this every repaint flipped the UI back to Training.
                still_sampling = sampling_active and new_step <= sampling_step
                sampling_active = still_sampling
                if not still_sampling and pending_epoch is not None:
                    # Pause over — adopt the epoch the loop logged during it.
                    current_epoch = pending_epoch
                    pending_epoch = None
                current_step = new_step
                total_steps = int(match.group(2))
                eta = _parse_eta_seconds(match.group(3))

                speed = (
                    f"{rate_match.group(1)} {rate_match.group(2)}"
                    if rate_match
                    else None
                )
                if loss_match:
                    last_loss = float(loss_match.group(1))

                self._collect_new_samples(
                    request.output_path,
                    request.output_name,
                    seen_samples,
                    samples,
                    job_id,
                )

                yield JobProgress(
                    job_id=job_id,
                    status=JobStatus.TRAINING,
                    current_step=current_step,
                    total_steps=total_steps,
                    current_epoch=current_epoch,
                    total_epochs=total_epochs,
                    loss=last_loss,
                    eta_seconds=eta,
                    speed=speed,
                    samples=samples,
                    log_lines=log_lines[-50:],
                    # An advancing step means we're actively training — clear
                    # any transient activity label (e.g. a prior "Saving").
                    # A bar frozen mid-sample keeps the sampling label instead.
                    phase=(
                        _sampling_phase(sample_image_index, sample_image_total)
                        if still_sampling
                        else None
                    ),
                )
            else:
                # Collapse repeats — sd-scripts prints some output once per
                # DataLoader worker, which would otherwise flood the log panel.
                _append_log_line(log_lines, line)

                lower = line.lower()
                if training_started:
                    # A tqdm bar during a sampling pause is the sampler's own
                    # diffusion bar for the image being rendered right now
                    # ("Sampling: 67%|…| 16/24 …") — the training bar was
                    # claimed above, so anything left here belongs to the
                    # sampler. Forward it so the UI can draw a determinate bar
                    # in the cell that image is destined for. Emitted only when
                    # the count moves, since tqdm redraws far faster than the
                    # UI needs.
                    if match and sampling_active:
                        bar = (int(match.group(1)), int(match.group(2)))
                        if bar != last_sample_bar:
                            # The sampler's bar restarts for each image, so a
                            # count falling back to the start IS the next image
                            # beginning — the only per-image signal from
                            # backends that echo no "prompt:" blocks.
                            if self.sample_bar_counts_images and (
                                last_sample_bar is None
                                or bar[0] < last_sample_bar[0]
                            ):
                                sample_image_index += 1
                            last_sample_bar = bar
                            # Claim whatever the previous image left on disk.
                            # The announce lines are otherwise the only scan
                            # points inside a pause, so without this an image
                            # stayed unclaimed for as long as the one after it
                            # took to render — its cell dashed while the next
                            # image's bar drew beside it. Throttled, since the
                            # `prompt:` line that opens each image already scans
                            # right after the previous one was written.
                            now = time.monotonic()
                            if now - last_sample_scan >= SAMPLE_SCAN_INTERVAL_S:
                                last_sample_scan = now
                                self._collect_new_samples(
                                    request.output_path,
                                    request.output_name,
                                    seen_samples,
                                    samples,
                                    job_id,
                                )
                            yield JobProgress(
                                job_id=job_id,
                                status=JobStatus.TRAINING,
                                current_step=current_step,
                                total_steps=total_steps,
                                current_epoch=current_epoch,
                                total_epochs=total_epochs,
                                loss=last_loss,
                                phase=_sampling_phase(
                                    sample_image_index, sample_image_total
                                ),
                                samples=samples,
                                log_lines=log_lines[-50:],
                                sample_progress=SampleProgress(
                                    current=bar[0], total=bar[1]
                                ),
                            )
                        continue

                    # Between steps sd-scripts pauses to save checkpoints or
                    # generate samples — the step bar freezes during that, so
                    # surface what it's doing as a one-line activity label.
                    activity = None
                    # Record saves at the step the bar is frozen on. sd-scripts
                    # prints "saving checkpoint: <file>" for every intermediate
                    # epoch/step save (train_network.py, immediately before the
                    # write) but "model saved." only once, for the final model —
                    # so the intermediate line is the save signal, with "model
                    # saved" catching the run-end save. The manager dedupes by
                    # step, which also collapses the final-epoch save and the
                    # end-of-run save landing on the same step.
                    saved: list[int] = []
                    if self._is_save_announce(line):
                        activity = self.save_phase_label
                        saved = [current_step]
                    elif (
                        "generating sample" in lower
                        or ("sample" in lower and "generat" in lower)
                        # Each image in the batch echoes its own "prompt:" block
                        # (height/width/scale/seed follow). Re-asserting on those
                        # keeps a multi-prompt event unbroken even if the opening
                        # "generating sample images" line was missed or scrolled
                        # past — "negative_prompt:" deliberately doesn't match.
                        or lower.startswith("prompt:")
                        # Backend-specific announce wording (see the class attr).
                        or any(
                            p.search(lower)
                            for p in self.sample_announce_patterns
                        )
                    ):
                        announce = SAMPLE_ANNOUNCE_PATTERN.search(lower)
                        if announce:
                            sampling_step = int(announce.group(1))
                        elif not sampling_active:
                            # Re-armed off a "prompt:" line without the opening
                            # announcement (missed, or the sampler logged out of
                            # order) — the frozen bar is the best anchor we have.
                            sampling_step = current_step
                        # The sampler's bar restarts per image, so drop the last
                        # reading rather than letting a finished image's count
                        # suppress the first tick of the next one.
                        if not sampling_active:
                            last_sample_bar = None
                            # A new event: restart the image count, whether this
                            # is the announcement or a "prompt:" line we re-armed
                            # off. The increment below then makes the latter the
                            # event's first image, same as if we'd seen both.
                            sample_image_index = 0
                        # Latch the pause so the sampler's own tqdm bars are read
                        # as sample progress (branch above) rather than training
                        # steps, until the real training bar ("steps" / avr_loss)
                        # moves past that step.
                        sampling_active = True
                        # One "prompt:" block precedes each image, so counting
                        # them tracks which one is on the GPU. The announcement
                        # itself isn't one — it opens the event at 0, and the
                        # first image's block takes it to 1.
                        if lower.startswith("prompt:"):
                            sample_image_index += 1
                        activity = _sampling_phase(
                            sample_image_index, sample_image_total
                        )
                    elif self._is_save_done(line):
                        activity = "Checkpoint saved"
                        saved = [current_step]
                    if activity is not None:
                        self._collect_new_samples(
                            request.output_path,
                            request.output_name,
                            seen_samples,
                            samples,
                            job_id,
                        )
                        yield JobProgress(
                            job_id=job_id,
                            status=JobStatus.TRAINING,
                            current_step=current_step,
                            total_steps=total_steps,
                            current_epoch=current_epoch,
                            total_epochs=total_epochs,
                            loss=last_loss,
                            phase=activity,
                            saved_checkpoints=saved,
                            samples=samples,
                            log_lines=log_lines[-50:],
                        )
                else:
                    # A tqdm bar here is a setup phase (caching latents / TE
                    # outputs / loading the DiT) — surface its count so the UI
                    # can show a determinate bar under the phase label, plus the
                    # bar's own it/s rate and ETA (which sit in the bracket, same
                    # as the training bar) so a slow cache doesn't look stalled.
                    prep_current = 0
                    prep_total = 0
                    prep_eta = None
                    prep_speed = None
                    if match:
                        prep_current = int(match.group(1))
                        prep_total = int(match.group(2))
                        prep_eta = _parse_eta_seconds(match.group(3))
                        prep_speed = (
                            f"{rate_match.group(1)} {rate_match.group(2)}"
                            if rate_match
                            else None
                        )
                    yield JobProgress(
                        job_id=job_id,
                        status=JobStatus.PREPARING,
                        current_step=prep_current,
                        total_steps=prep_total,
                        eta_seconds=prep_eta,
                        speed=prep_speed,
                        phase=preparing_phase,
                        log_lines=log_lines[-50:],
                    )

        if abandoned_pipes:
            # No EOF is coming; don't await readers that will never finish.
            for task in drain_tasks:
                task.cancel()
            await asyncio.gather(*drain_tasks, return_exceptions=True)
        else:
            for task in drain_tasks:
                await task
        return_code = await proc.wait()
        run.process = None

        # User asked to stop: cancel_job() emits the CANCELLED update, so the
        # non-zero exit from the kill is expected — don't report it as a failure.
        if run.cancelled:
            return

        # A run that ended inside a sampling pause never got the training bar
        # that would have adopted the held epoch — the terminal event should
        # still report the last one the trainer logged.
        if pending_epoch is not None:
            current_epoch = pending_epoch

        # Final scan — samples generated at the last save/end land after the
        # last training-bar update, so catch any stragglers here. Runs on the
        # failure path too: progress updates replace client state wholesale, so
        # a terminal yield without `samples` would wipe everything collected.
        # The trainer has exited by now, so nothing can be mid-write and this is
        # the last chance to claim anything: skip the settle gate.
        self._collect_new_samples(
            request.output_path,
            request.output_name,
            seen_samples,
            samples,
            job_id,
            require_settled=False,
        )

        if return_code == 0:
            # Final retention pass — the last cadence save has no following
            # epoch line to trigger on. Clean exits only: after a failure the
            # newest checkpoint may be the broken one, and every earlier save
            # is exactly what the user will want to fall back to.
            self._housekeep_checkpoints(request)
            yield JobProgress(
                job_id=job_id,
                status=JobStatus.COMPLETED,
                # Report the bar as full so the UI settles at 100% instead of
                # snapping the completed bar back to empty.
                current_step=total_steps,
                total_steps=total_steps,
                current_epoch=current_epoch,
                total_epochs=total_epochs,
                log_lines=log_lines[-50:],
                samples=samples,
            )
        else:
            tail = stderr_lines[-10:] if stderr_lines else log_lines[-10:]
            detail = "\n".join(tail).strip()
            error_msg = f"Training process exited with code {return_code}"
            if detail:
                error_msg = f"{error_msg}\n{detail}"
            merged_logs = (log_lines + stderr_lines)[-50:]
            yield JobProgress(
                job_id=job_id,
                status=JobStatus.FAILED,
                error=error_msg,
                log_lines=merged_logs,
                samples=samples,
            )

    # --- Setup phases (used by backends that cache in separate processes) ---

    async def _run_phase_subprocess(
        self,
        job_id: str,
        run: SubprocessRun,
        argv: list[str],
        cwd: str,
        env: dict,
        phase_label: str,
    ) -> AsyncGenerator[JobProgress, None]:
        """Run a setup subprocess, reporting its tqdm bars as PREPARING ticks.

        musubi-tuner caches latents and text-encoder outputs in their own
        processes before training; each is a plain script with a tqdm bar, so
        the bar becomes a determinate progress readout under `phase_label`.

        Honours `run.cancelled` (the process is registered on `run` so a cancel
        arriving mid-phase kills it) and raises RuntimeError with a stderr tail
        if the phase exits non-zero — the run loop turns that into a FAILED
        job rather than silently training on missing caches.
        """
        proc = await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        run.process = proc

        log_lines: list[str] = list(run.log_prelude)
        stderr_lines: list[str] = []
        line_queue, drain_tasks = _merge_output(proc)

        eofs_seen = 0
        abandoned_pipes = False
        while eofs_seen < 2:
            try:
                item, is_stderr = await asyncio.wait_for(
                    line_queue.get(), timeout=STREAM_READ_TIMEOUT_S
                )
            except asyncio.TimeoutError:
                if proc.returncode is not None:
                    abandoned_pipes = True
                    break
                continue
            if item is _EOF:
                eofs_seen += 1
                continue
            line = item

            if is_stderr:
                stderr_lines.append(line)
            _append_log_line(log_lines, line)

            if run.cancelled:
                break

            match = TQDM_PATTERN.search(line)
            rate_match = RATE_PATTERN.search(line) if match else None
            yield JobProgress(
                job_id=job_id,
                status=JobStatus.PREPARING,
                current_step=int(match.group(1)) if match else 0,
                total_steps=int(match.group(2)) if match else 0,
                eta_seconds=_parse_eta_seconds(match.group(3)) if match else None,
                speed=(
                    f"{rate_match.group(1)} {rate_match.group(2)}"
                    if rate_match
                    else None
                ),
                phase=phase_label,
                log_lines=log_lines[-50:],
            )

        if abandoned_pipes or run.cancelled:
            for task in drain_tasks:
                task.cancel()
            await asyncio.gather(*drain_tasks, return_exceptions=True)
        else:
            for task in drain_tasks:
                await task

        if run.cancelled:
            # cancel_training() owns killing the process and the manager emits
            # the CANCELLED update; nothing left to report here. Still drop
            # the handle before returning — every other exit from this
            # function (and from `_stream_training_progress`) clears
            # `run.process` once it stops owning the subprocess, and this was
            # the one path that didn't, leaving a dead handle a second cancel
            # or a diagnostic read could mistake for a live process.
            run.process = None
            return

        return_code = await proc.wait()
        run.process = None
        if return_code != 0:
            tail = "\n".join((stderr_lines or log_lines)[-10:]).strip()
            message = f"{phase_label} failed with exit code {return_code}"
            raise RuntimeError(f"{message}\n{tail}" if tail else message)

    # --- Cancellation ---

    async def cancel_training(self, job_id: str) -> None:
        """Cancel the run the manager knows as `job_id`. No-op if unknown."""
        run = self._runs.get(job_id)
        if run is None:
            return

        run.cancelled = True
        proc = run.process
        if proc is None:
            # Cancelled before the spawn — the flag is enough; the run loop
            # checks it and never launches.
            return

        if sys.platform == "win32":
            # accelerate spawns child worker processes; kill the whole tree.
            # Spawned rather than os.system() so the kill doesn't block the
            # event loop (and with it every other job's progress) while it runs.
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/F",
                "/T",
                "/PID",
                str(proc.pid),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.wait()
        else:
            proc.send_signal(signal.SIGTERM)

        try:
            await asyncio.wait_for(proc.wait(), timeout=10)
        except asyncio.TimeoutError:
            proc.kill()

        run.process = None

    # --- Sample prompt files ---

    def _add_missing_sample_flags(
        self,
        line: str,
        width: int,
        height: int,
        steps: int,
        guidance: str,
        guidance_flag: Optional[str] = None,
    ) -> str:
        """Append the size/steps/guidance flags to a sample prompt line, unless
        the user already set that flag on the line themselves (their explicit
        choice wins). The guidance flag differs per backend — and per model
        within a backend (sd-scripts Flux and musubi Flux.2 read `--g` where
        their siblings read `--l`), hence the per-call override of
        `sample_guidance_flag`.
        """
        flag = guidance_flag or self.sample_guidance_flag
        extras: list[str] = []
        if not _prompt_line_has_flag(line, "w"):
            extras.append(f"--w {width}")
        if not _prompt_line_has_flag(line, "h"):
            extras.append(f"--h {height}")
        if not _prompt_line_has_flag(line, "s"):
            extras.append(f"--s {steps}")
        if not _prompt_line_has_flag(line, flag):
            extras.append(f"--{flag} {guidance}")
        if not extras:
            return line
        return line + " " + " ".join(extras)


# --- Helpers ---


def _prompt_line_has_flag(line: str, flag: str) -> bool:
    r"""Whether `line` already sets `--{flag}` in sd-scripts prompt-line syntax.

    Mirrors library/sampling.py's line_to_prompt_dict: a prompt line is split
    on " --" and each resulting segment matched against e.g. `r"w (\d+)"` at
    its start — so we replicate that same split/prefix check rather than a
    naive substring search (which would e.g. mistake "--ss euler_a" for a "-s"
    steps flag).
    """
    for segment in line.split(" --")[1:]:
        m = re.match(r"^(\w+)\s", segment)
        if m and m.group(1).lower() == flag:
            return True
    return False


def _parse_kv_args(raw) -> list[str]:
    """Parse a freeform `key=value key2="a value"` string into arg chunks.

    Keeps only chunks that contain '=' (a bare key with no value, or stray
    tokens, are silently dropped — the UI surfaces a non-blocking hint for
    malformed input). Used for the expert-tier --network_args /
    --optimizer_args editors.

    Split with shlex rather than `str.split()` so a quoted value containing
    spaces survives as one arg (`algo="lokr full"` used to be truncated to
    `algo="lokr`, which argparse then handed to sd-scripts as a broken value).
    POSIX mode is what strips the quotes and joins `key=` to its quoted value,
    but its backslash escaping would eat Windows paths — so escaping is turned
    off, and `#` is not treated as a comment.
    """
    if not raw:
        return []
    text = str(raw)
    lexer = shlex.shlex(text, posix=True)
    lexer.whitespace_split = True
    lexer.escape = ""
    lexer.commenters = ""
    try:
        chunks = list(lexer)
    except ValueError:
        # Unbalanced quotes — fall back to plain whitespace splitting rather
        # than dropping the user's input entirely.
        chunks = text.split()

    return [chunk for chunk in chunks if "=" in chunk]


_NATIVE_RESO_RE = re.compile(r"^(\d+)\s*[x×,]\s*(\d+)$", re.IGNORECASE)


def _parse_native_resolution(raw) -> Optional[tuple[int, int]]:
    """Parse an exact `WxH` training size (e.g. "1280x768"). Empty/None = off.

    sd-scripts' dataset `resolution` accepts a scalar or a [W, H] pair, but a
    scalar means a *square* WxW — it resizes to fit and centre-crops. Emitting
    the pair is the only way to train at a non-square size without resampling,
    which is what pixel-art datasets need (any non-integer rescale destroys the
    pixel grid before the VAE ever sees it).

    Both dimensions must be divisible by 8: the VAE downsamples by 8x, and
    sd-scripts silently rounds off-grid sizes, which would defeat the point of
    asking for an exact size in the first place.
    """
    if not raw:
        return None
    match = _NATIVE_RESO_RE.match(str(raw).strip())
    if not match:
        raise ValueError(
            f"Invalid native resolution {raw!r} — expected WxH, e.g. 1280x768"
        )
    width, height = int(match.group(1)), int(match.group(2))
    if width <= 0 or height <= 0:
        raise ValueError(f"Native resolution {raw!r} must be positive")
    if width % 8 or height % 8:
        raise ValueError(
            f"Native resolution {width}x{height} must be divisible by 8 "
            "(the VAE downsamples by 8x)"
        )
    return width, height


def _toml_bool(value: bool) -> str:
    return "true" if value else "false"


def _toml_str(value: str) -> str:
    """Emit a TOML basic string with backslashes/quotes escaped.

    Windows dataset paths are full of backslashes, which TOML treats as escape
    sequences — escaping them keeps the generated config valid.
    """
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def _num(value) -> str:
    """Format a number for a CLI flag without trailing float noise.

    Integers stay integers; floats keep their repr (e.g. 1e-4 -> '0.0001').
    """
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    f = float(value)
    if f.is_integer():
        return str(int(f))
    return repr(f)


def _find_python(scripts_path: Path) -> str:
    """Find the Python executable for a trainer checkout's environment.

    Prefers a `venv`/`.venv` inside the checkout, then a sibling
    `python_embeded`, then falls back to the sidecar's own interpreter (which
    will fail loudly rather than hang).
    """
    if sys.platform == "win32":
        candidates = [
            scripts_path / "venv" / "Scripts" / "python.exe",
            scripts_path / ".venv" / "Scripts" / "python.exe",
            scripts_path.parent / "python_embeded" / "python.exe",
        ]
    else:
        candidates = [
            scripts_path / "venv" / "bin" / "python",
            scripts_path / ".venv" / "bin" / "python",
            scripts_path.parent / "python_embeded" / "bin" / "python",
        ]

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    return sys.executable
