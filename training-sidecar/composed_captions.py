"""Run-scoped caption files for the sd-scripts-lineage backends.

ai-toolkit takes a composed caption inline in its dataset manifest, so its half
of per-run caption composition costs nothing on disk (see `dataset_manifest`).
sd-scripts and musubi-tuner both derive the caption path from the image path —
`os.path.splitext(image)[0] + caption_extension` — so the composed text has to
be a real file beside the image.

It does not have to be `.txt`. Both backends take `caption_extension` per
dataset entry, so a run writes its composed captions under an extension only it
uses, points its generated TOML at that extension, and deletes them when the job
reaches a terminal state. The canonical `.txt` the tagging UI owns is only ever
read (see `docs/caption-composition-design.md` for why that constraint drives
the whole design).

Extension format: `.attribic-<job-id>`, e.g. `portrait-01.attribic-a588e5f13005`.

  * The stable `attribic-` prefix is what makes orphans from a killed sidecar
    sweepable without knowing which job ids were live.
  * The job id is what keeps two concurrent runs over the same dataset folder —
    the queue is multi-worker, and "train this set two ways at once" is the
    experiment this feature invites — from overwriting each other's captions.
  * There is deliberately **no** trailing `.txt`. musubi-tuner filters its image
    list down to images that have a caption file, matching them by
    `os.path.splitext(os.path.basename(caption_path))[0]`
    (`dataset/media_utils.py:glob_images`). That strips one suffix only, so a
    two-part `.attribic-<id>.txt` would reduce to `portrait-01.attribic-<id>`,
    match no image, and silently empty the dataset.

Composition is decided per folder by whether anything in it carries a hybrid
delimiter. A folder with none is left completely alone — no files written, no
extension override — so this is inert for every non-hybrid project.

When a folder *is* composed, every `.txt` in it gets a companion file, not just
the hybrid ones: the extension override applies to the whole subset, so an image
whose caption we skipped would train on an empty caption (sd-scripts) or drop
out of the dataset entirely (musubi-tuner).
"""

from __future__ import annotations

from pathlib import Path
from typing import NamedTuple, Optional

from caption_compose import EMISSIONS, compose, split_hybrid

# Marks a file as ours, for both the per-run delete and the orphan sweep.
EXTENSION_PREFIX = ".attribic-"


def extension_for_job(job_id: str) -> str:
    """The caption extension a run writes and reads its composed captions under."""
    return f"{EXTENSION_PREFIX}{job_id}"


class FolderComposition(NamedTuple):
    """Outcome for one dataset folder.

    `written` is how many companion files the folder now holds, `changed` how
    many of those differ from the `.txt` beside them (i.e. actually carried a
    delimiter), and `emptied` how many captions the chosen half left empty.

    The last one is worth reporting: no file is written for an empty caption, so
    the image falls back to the backend's own no-caption behaviour — a warning
    and an empty caption under sd-scripts, dropped from the dataset under
    musubi-tuner. Neither is necessarily a mistake (style training on bare
    captions is a real workflow), so the caller says so rather than refusing.
    """

    written: int
    changed: int
    emptied: int


def _sidecars(folder: str) -> list[Path]:
    """The `.txt` files directly in `folder`, sorted. Subfolders excluded."""
    try:
        entries = list(Path(folder).iterdir())
    except OSError:
        return []
    return sorted(
        p
        for p in entries
        if p.is_file() and not p.name.startswith(".") and p.suffix.lower() == ".txt"
    )


def _read(path: Path) -> Optional[str]:
    """A sidecar's text, or None when it can't be read.

    Unreadable is left alone rather than composed: the backends resolve captions
    themselves, and whatever they make of the file is a better outcome than this
    run inventing a replacement for it.
    """
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def compose_folder(
    folder: str, emission: Optional[str], job_id: str
) -> Optional[FolderComposition]:
    """Write this run's caption files for one dataset folder.

    Returns None when the folder needs no composition — no emission, nothing
    readable, or nothing in it carrying a hybrid delimiter — in which case
    nothing was written and the caller must leave `caption_extension` alone so
    the backend reads the `.txt` files as it always has.
    """
    if emission not in EMISSIONS:
        return None

    sidecars = _sidecars(folder)
    if not sidecars:
        return None

    # Read once: the delimiter check and the composition both need the text, and
    # a dataset folder is re-read often enough already.
    raw_by_path: dict[Path, str] = {}
    for path in sidecars:
        raw = _read(path)
        if raw is not None:
            raw_by_path[path] = raw

    if not any(split_hybrid(raw)[1] is not None for raw in raw_by_path.values()):
        # Not a hybrid folder. Every emission would return the file itself, so
        # writing companions would be pure churn in the user's dataset folder.
        return None

    extension = extension_for_job(job_id)
    written = 0
    changed = 0
    emptied = 0
    for path, raw in raw_by_path.items():
        composed = compose(raw, emission)
        if not composed:
            # No file: an empty companion would trip sd-scripts' "caption file
            # is empty" assertion and take the whole run down with it.
            emptied += 1
            continue
        path.with_suffix(extension).write_text(composed + "\n", encoding="utf-8")
        written += 1
        if composed != raw.strip():
            changed += 1

    return FolderComposition(written, changed, emptied)


def _job_id_of(path: Path) -> Optional[str]:
    """The job id a composed caption file belongs to, or None if it isn't ours.

    Matches on the final suffix rather than the whole name, so a user's own
    `holiday.attribic-notes.jpg` is never mistaken for one of these.
    """
    if not path.suffix.startswith(EXTENSION_PREFIX):
        return None
    return path.suffix[len(EXTENSION_PREFIX) :] or None


def _remove(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except OSError:
        return False


def cleanup_run(folders: list[str], job_id: str) -> int:
    """Delete one run's composed captions. Returns how many files went."""
    extension = extension_for_job(job_id)
    removed = 0
    for folder in folders:
        try:
            entries = list(Path(folder).iterdir())
        except OSError:
            continue
        for path in entries:
            if path.suffix == extension and path.is_file() and _remove(path):
                removed += 1
    return removed


def sweep_orphans(folders: list[str], active_job_ids: set[str]) -> int:
    """Delete composed captions left behind by runs that are no longer live.

    Covers the case the on-end cleanup cannot: the sidecar being killed
    mid-run. Keyed on the live job set rather than on age, because a long run
    and a stale file look identical from the filesystem.
    """
    removed = 0
    for folder in folders:
        try:
            entries = list(Path(folder).iterdir())
        except OSError:
            continue
        for path in entries:
            owner = _job_id_of(path)
            if owner is None or owner in active_job_ids:
                continue
            if path.is_file() and _remove(path):
                removed += 1
    return removed
