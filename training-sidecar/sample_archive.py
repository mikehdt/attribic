"""Per-run archiving of training sample images.

Both backends write samples into folders they own — ai-toolkit into
`<loras>/<output_name>/samples/`, sd-scripts into a single `<loras>/sample/`
shared by every Kohya run. Leaving them there for the whole run makes a run's
images hostage to anything else that touches those folders, and (before this)
tied the handover to the browser being open at the moment the job went
terminal.

So each sample is copied into `<loras>/.run-samples/<job_id>/` the moment a
provider first sees it, and the emitted path points at the copy. A run owns its
images within one poll of them being written, whatever happens afterwards.

Copy rather than move: ai-toolkit's own UI serves its samples folder live, and
moving files out from under it would blank that viewer mid-run. The originals
are swept afterwards by the archive route at terminal — which is why each
entry keeps its `source_path`.

The naming scheme (`s{step:06d}-p{prompt:02d}[-e{epoch}]{ext}`) is mirrored in
`src/app/api/training/samples/archive/route.ts`, which still handles runs whose
samples were collected before this copy existed. Keep the two in step.
"""

import shutil
import time
from pathlib import Path
from typing import Optional

from models import SampleImage

# Sibling of the backends' own output folders, under the loras root. Dotted so
# it sorts out of the way of the LoRAs themselves.
ARCHIVE_DIR_NAME = ".run-samples"

# A sample file is only claimed once it has been untouched for this long. The
# trainers write images with a plain `save()`, so a scan that lands mid-write
# would otherwise copy a truncated image — and unlike the source, the copy is
# never rewritten. Files that fail the check are simply left unclaimed for the
# next poll.
SETTLE_SECONDS = 1.0


def is_settled(path: str, now: Optional[float] = None) -> bool:
    """True if `path` looks completely written (non-empty and not just touched)."""
    try:
        stat = Path(path).stat()
    except OSError:
        return False
    if stat.st_size == 0:
        return False
    return (now if now is not None else time.time()) - stat.st_mtime >= SETTLE_SECONDS


def _archive_name(sample: SampleImage, ext: str) -> str:
    """Normalised archive filename — all metadata survives in the name.

    The epoch segment appears only for epoch-cadence runs, matching the
    client-side archive route.
    """
    epoch = f"-e{sample.epoch}" if sample.epoch is not None else ""
    return f"s{sample.step:06d}-p{sample.prompt_index:02d}{epoch}{ext}"


def copy_into_run_archive(
    output_path: str, job_id: Optional[str], source: str, sample: SampleImage
) -> SampleImage:
    """Copy one freshly-seen sample into the run's archive folder.

    Returns a SampleImage pointing at the copy, with `source_path` carrying the
    original so it can be swept once the run is over. On any failure — or when
    there's no job_id to key the folder on — the sample is returned untouched,
    so the run still surfaces the image from wherever the trainer left it.
    """
    if not job_id:
        return sample

    try:
        archive_dir = Path(output_path) / ARCHIVE_DIR_NAME / job_id
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
        path=f"{ARCHIVE_DIR_NAME}/{job_id}/{name}",
        step=sample.step,
        epoch=sample.epoch,
        prompt_index=sample.prompt_index,
        source_path=sample.path,
    )
