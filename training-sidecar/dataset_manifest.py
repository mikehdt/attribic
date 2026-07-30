"""Explicit dataset file lists, so ai-toolkit trains on what the UI counted.

ai-toolkit enumerates a dataset folder *recursively* — `toolkit/data_loader.py`
walks the tree with `os.walk` and excludes only a folder literally named
`_controls` — so every subfolder of a dataset folder becomes training data.
That silently pulls in:

  * a `orig/` (or similar) holding the shots the user deliberately pulled out
    of the set, often near-duplicates of the crops they kept
  * our own `.tagging/` metadata folder, whose `project.png` thumbnail has no
    `.txt` sidecar and so trains on an *empty* caption — `dataloader_mixins.py`
    falls back to `''` when there's no sidecar and `default_caption` is unset
  * for a project whose images sit in the root, the `N_label` repeat folders
    that are already separate dataset entries, i.e. trained twice

Our own enumeration is flat: one dataset entry means one folder and the images
directly in it (the Node side lists a project's root and each `N_label`
subfolder as its own entry). A trainer that disagrees with the count on screen
is expensive to notice — nothing errors, the run just quietly trains on the
wrong set, and deleting a stray subfolder mid-run kills the job because the
file list was resolved at dataset-build time.

ai-toolkit accepts a JSON file in place of a folder: a `dataset_path` that
isn't a directory is loaded as a dict keyed by image path. We write one per
dataset entry holding a flat listing, which makes the trained set exactly the
counted set. Entry values are left empty so ai-toolkit still reads each image's
`.txt` sidecar for the caption — `load_caption` only takes an inline caption
when the entry carries a `"caption"` key, which leaves room to compose per-run
captions (tags only / natural language only / both) without ever rewriting the
files the tagging UI owns.

Kohya needs none of this: its `glob_images` is a flat per-directory glob.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple, Optional

# Mirrors `image_extensions` in ai-toolkit's toolkit/data_loader.py, so a
# manifest only ever drops strays from the listing — it never changes which
# files are eligible in the first place.
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


class ManifestResult(NamedTuple):
    """Outcome for one dataset entry.

    `path` is None when there was nothing to list, in which case the caller
    should leave ai-toolkit its `folder_path` — handing it an empty manifest
    fails later with a much less obvious message than an empty folder does.
    """

    path: Optional[str]
    count: int


def list_dataset_images(folder: str) -> list[str]:
    """Images directly in `folder`, sorted. Subfolders and dotfiles excluded.

    Dotfiles are skipped to match ai-toolkit's own listing, which ignores names
    starting with `.` (it does not, however, skip dot *folders* — the reason
    `.tagging/project.png` ended up in training sets).
    """
    try:
        entries = list(Path(folder).iterdir())
    except OSError:
        return []
    return sorted(
        str(p)
        for p in entries
        if p.is_file()
        and not p.name.startswith(".")
        and p.suffix.lower() in IMAGE_EXTENSIONS
    )


def build_manifests(folders: list[str], run_dir: Path) -> list[ManifestResult]:
    """Write one file list per folder into `run_dir`, index-aligned with input.

    Manifests live in the run's own job folder rather than in the dataset
    folder, which also stops ai-toolkit writing its `.aitk_size.json` dimension
    cache into the user's dataset folders: it derives that cache's location
    from the manifest's parent directory. The cost is that image dimensions are
    re-read each run instead of being cached across runs.
    """
    run_dir.mkdir(parents=True, exist_ok=True)
    results: list[ManifestResult] = []
    for index, folder in enumerate(folders):
        files = list_dataset_images(folder)
        if not files:
            results.append(ManifestResult(None, 0))
            continue
        path = run_dir / f"dataset-{index}.filelist.json"
        path.write_text(
            json.dumps({f: {} for f in files}, indent=1), encoding="utf-8"
        )
        results.append(ManifestResult(str(path), len(files)))
    return results
