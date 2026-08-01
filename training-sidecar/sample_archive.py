"""Per-run archiving of training sample images.

Both backends write samples into folders they own — ai-toolkit into
`<loras>/<output_name>/samples/`, sd-scripts into a single `<loras>/sample/`
shared by every Kohya run. Leaving them there for the whole run makes a run's
images hostage to anything else that touches those folders, and (before this)
tied the handover to the browser being open at the moment the job went
terminal.

So each sample is copied into the run's own job folder —
`<training>/jobs/<job_id>/samples/`, alongside the generated TOML and metadata
JobManager already puts there — the moment a provider first sees it, and the
emitted path points at the copy. A run owns its images within one poll of them
being written, whatever happens afterwards, and everything one run produced
sits in one place rather than scattered across the loras folder.

Note this puts archived samples under a *different root* from the trainers'
own output: emitted paths are relative to the training root
(`jobs/<id>/samples/<file>`), while an unarchived sample's path stays relative
to the loras root (`sample/<file>`, `<name>/samples/<file>`). The client tells
the two apart by the leading `jobs/` segment when it builds a serving URL, which
makes `jobs` a reserved name at the loras root — see `sampleUrl` in
`src/app/shared/activity-panel/training-detail-modal/training-detail-tabs/samples-model.ts`.

Copy rather than move: ai-toolkit's own UI serves its samples folder live, and
moving files out from under it would blank that viewer mid-run. The originals
are swept afterwards by the archive route at terminal — which is why each
entry keeps its `source_path`.

The naming scheme (`s{step:06d}-p{prompt:02d}[-e{epoch}]{ext}`) is mirrored in
`src/app/api/training/samples/archive/route.ts`, which archives the long way
for any sample this copy couldn't claim. Keep the two in step.
"""

import shutil
import time
from collections.abc import Callable
from pathlib import Path
from typing import Optional

from models import SampleImage

# Subfolder of the run's job dir. The job dir (`<training>/jobs/<job_id>/`) is
# created by JobManager for the generated TOML and already holds the run's
# metadata, so samples join what's there rather than starting a parallel tree.
# Job-keyed rather than name-keyed, so re-runs of one output name stay separate
# and the layout doesn't depend on a backend making a folder per run — Kohya
# doesn't; its output_dir is the shared loras root.
SAMPLES_SUBDIR = "samples"

# Set once at startup from `SidecarConfig.training_dir`. Module-level because
# it's a process-wide constant that every provider needs and none of them
# otherwise knows — threading it through four `start_training` signatures buys
# nothing. `copy_into_run_archive` no-ops (returns the sample untouched) until
# it's configured, so a misordered startup degrades to the old behaviour of
# serving images from wherever the trainer left them.
_jobs_dir: Optional[Path] = None


def configure(jobs_dir: Path) -> None:
    """Point archiving at `<training>/jobs`. Called once from the app lifespan."""
    global _jobs_dir
    _jobs_dir = jobs_dir

# Fallback gate for a format we can't inspect: claim it only once it has been
# untouched for this long. The trainers write images with a plain `save()`, so a
# scan that lands mid-write would otherwise copy a truncated image — and unlike
# the source, the copy is never rewritten. Files that fail the check are simply
# left unclaimed for the next poll.
SETTLE_SECONDS = 1.0

# End markers that can only be on disk once the whole file is. Preferred over
# the quiet window above, which cost a finished sample up to a second of sitting
# unclaimed — long enough that the grid dashed its cell and drew the *next*
# image's progress bar before the finished one appeared.
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_TRAILER = b"\x00\x00\x00\x00IEND\xaeB`\x82"  # the mandatory closing chunk
JPEG_MAGIC = b"\xff\xd8\xff"
JPEG_TRAILER = b"\xff\xd9"  # EOI


def _is_complete_image(path: Path, size: int) -> Optional[bool]:
    """Whether `path` is a fully-written image, judged by its own format.

    Returns None when the header names no format we can check, so the caller
    falls back to the quiet-window rule. Every format the trainers write either
    ends with a marker that can't be there before the last byte is (PNG's IEND
    chunk, JPEG's EOI) or declares its own length up front (RIFF/WebP).
    """
    try:
        with path.open("rb") as handle:
            head = handle.read(12)
            if head.startswith(PNG_MAGIC):
                trailer = PNG_TRAILER
            elif head.startswith(JPEG_MAGIC):
                trailer = JPEG_TRAILER
            elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                # The RIFF header states the payload size, so the file is whole
                # once that many bytes (plus the 8-byte header) have landed.
                return int.from_bytes(head[4:8], "little") + 8 <= size
            else:
                return None
            if size < len(trailer):
                return False
            handle.seek(-len(trailer), 2)
            return handle.read(len(trailer)) == trailer
    except OSError:
        return False


def is_settled(path: str, now: Optional[float] = None) -> bool:
    """True if `path` looks completely written (non-empty and not truncated)."""
    try:
        stat = Path(path).stat()
    except OSError:
        return False
    if stat.st_size == 0:
        return False
    complete = _is_complete_image(Path(path), stat.st_size)
    if complete is not None:
        return complete
    return (now if now is not None else time.time()) - stat.st_mtime >= SETTLE_SECONDS


def _archive_name(sample: SampleImage, ext: str) -> str:
    """Normalised archive filename — all metadata survives in the name.

    The epoch segment appears only for epoch-cadence runs, matching the
    client-side archive route.
    """
    epoch = f"-e{sample.epoch}" if sample.epoch is not None else ""
    return f"s{sample.step:06d}-p{sample.prompt_index:02d}{epoch}{ext}"


def copy_into_run_archive(
    job_id: Optional[str], source: str, sample: SampleImage
) -> SampleImage:
    """Copy one freshly-seen sample into the run's job folder.

    Returns a SampleImage whose `path` is relative to the training root
    (`jobs/<job_id>/samples/<file>`), with `source_path` carrying the trainer's
    original so it can be swept once the run is over. On any failure — no
    job_id, unconfigured, or an OS error — the sample is returned untouched, so
    the run still surfaces the image from wherever the trainer left it.
    """
    if not job_id or _jobs_dir is None:
        return sample

    try:
        archive_dir = _jobs_dir / job_id / SAMPLES_SUBDIR
        archive_dir.mkdir(parents=True, exist_ok=True)

        ext = Path(source).suffix.lower()
        base = _archive_name(sample, ext)
        stem = base[: -len(ext)] if ext else base

        # Same-name collision (e.g. two samples whose step couldn't be parsed
        # both normalise to s000000) — disambiguate, never silently overwrite.
        name = base
        n = 2
        while (archive_dir / name).exists():
            name = f"{stem}-{n}{ext}"
            n += 1

        shutil.copy2(source, archive_dir / name)
    except OSError:
        return sample

    return SampleImage(
        path=f"jobs/{job_id}/{SAMPLES_SUBDIR}/{name}",
        step=sample.step,
        epoch=sample.epoch,
        prompt_index=sample.prompt_index,
        source_path=sample.path,
    )


def collect_new_samples(
    *,
    scan: Callable[[str, str], set[str]],
    parse: Callable[[str, str], Optional[SampleImage]],
    output_path: str,
    output_name: str,
    seen: set[str],
    samples: list[SampleImage],
    job_id: Optional[str] = None,
    require_settled: bool = True,
) -> None:
    """Diff a provider's sample folder against `seen`, claiming what's new.

    Each new file is copied into the run's archive folder as it's claimed, so
    the run owns its images immediately rather than at terminal — which matters
    most for Kohya, whose `sample/` folder is shared by every run. A file that's
    still being written is left unclaimed for the next sweep, except on the
    final sweep, which runs after the trainer has exited (so nothing can still
    be mid-write) and is the last chance to claim anything: pass
    `require_settled=False` there.

    Backends differ only in where samples land and how their filenames encode
    step/epoch/prompt, so those two steps arrive as `scan` and `parse`; the
    claim-once-and-archive logic around them is identical and lives here.

    Mutates both `seen` (so a file is claimed once) and `samples` (the running
    ordered list forwarded on JobProgress).
    """
    new_files = scan(output_path, output_name) - seen
    if not new_files:
        return
    for path in sorted(new_files):
        if require_settled and not is_settled(path):
            continue  # mid-write — re-examined next sweep
        seen.add(path)
        entry = parse(path, output_name)
        if entry is not None:
            samples.append(copy_into_run_archive(job_id, path, entry))
