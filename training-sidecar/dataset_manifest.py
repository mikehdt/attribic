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
counted set.

Entry values are normally left empty so ai-toolkit reads each image's `.txt`
sidecar for the caption — `load_caption` only takes an inline caption when the
entry carries a `"caption"` key. That is also how per-run caption composition
rides along: when a dataset picks an emission, the entries whose composed text
differs from the file carry it inline, and the files the tagging UI owns are
never rewritten. Nothing is written into the dataset folder either way.

Kohya needs none of this: its `glob_images` is a flat per-directory glob.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NamedTuple, Optional

from caption_compose import compose_for_image

# Mirrors `image_extensions` in ai-toolkit's toolkit/data_loader.py, so a
# manifest only ever drops strays from the listing — it never changes which
# files are eligible in the first place.
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


class ManifestResult(NamedTuple):
    """Outcome for one dataset entry.

    `path` is None when there was nothing to list, in which case the caller
    should leave ai-toolkit its `folder_path` — handing it an empty manifest
    fails later with a much less obvious message than an empty folder does.

    `composed` counts images whose caption this run composed, and `emptied`
    those where the chosen half turned out to be empty. The second is worth
    surfacing: an empty caption trains as an empty caption, since ai-toolkit's
    inline path skips the `default_caption` fallback it applies to sidecars. It
    is not necessarily a mistake — style training on bare captions is a real
    thing — so the caller reports the count rather than refusing the run.
    """

    path: Optional[str]
    count: int
    composed: int = 0
    emptied: int = 0


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


def build_manifests(
    folders: list[str],
    run_dir: Path,
    emissions: Optional[list[Optional[str]]] = None,
) -> list[ManifestResult]:
    """Write one file list per folder into `run_dir`, index-aligned with input.

    Manifests live in the run's own job folder rather than in the dataset
    folder, which also stops ai-toolkit writing its `.aitk_size.json` dimension
    cache into the user's dataset folders: it derives that cache's location
    from the manifest's parent directory. The cost is that image dimensions are
    re-read each run instead of being cached across runs.

    `emissions` is index-aligned with `folders`; a non-None entry composes that
    folder's captions (see `caption_compose`). Composition is decided per file
    by whether it carries a hybrid delimiter, so a folder holding a mix degrades
    file by file rather than all or nothing, and a folder with no hybrid
    captions in it produces exactly the manifest it would have without this.
    """
    run_dir.mkdir(parents=True, exist_ok=True)
    emissions = list(emissions or [])
    emissions += [None] * (len(folders) - len(emissions))

    results: list[ManifestResult] = []
    for index, folder in enumerate(folders):
        files = list_dataset_images(folder)
        if not files:
            results.append(ManifestResult(None, 0))
            continue

        emission = emissions[index]
        entries: dict[str, dict] = {}
        composed_count = 0
        emptied_count = 0
        for f in files:
            composed = compose_for_image(f, emission)
            if composed is None:
                # Nothing to say — ai-toolkit reads the `.txt` itself.
                entries[f] = {}
                continue
            entries[f] = {"caption": composed}
            composed_count += 1
            if not composed:
                emptied_count += 1

        path = run_dir / f"dataset-{index}.filelist.json"
        path.write_text(json.dumps(entries, indent=1), encoding="utf-8")
        results.append(
            ManifestResult(str(path), len(files), composed_count, emptied_count)
        )
    return results
