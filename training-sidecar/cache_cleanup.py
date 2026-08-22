"""Post-run removal of the latent / text-encoder caches a backend leaves behind.

Opt-in per run (`cleanup_caches` in the hyperparameters) and only on a clean
end — completed, or cancelled by the user. A *failed* run keeps its caches:
whatever went wrong usually gets retried straight away, and re-caching a large
dataset costs minutes of VAE/text-encoder compute for nothing. A run whose
sidecar was killed keeps them too, simply because nothing runs to remove them.

Each backend caches somewhere different:

  * **Kohya** (sd-scripts) writes one `.npz` per image *beside the image*:
    `<stem>_<WWWWxHHHH><arch>.npz` for latents (`_sdxl`/`_flux`/`_anima`/…, or a
    bare `.npz` for the legacy SD strategy) and `<stem>_te_outputs.npz` /
    `<stem>_<arch>_te.npz` for text-encoder outputs. Rather than track that
    growing suffix list, `sweep_image_sidecar_caches` deletes any `.npz` whose
    name starts with the stem of an image in the same folder — every strategy
    names its cache `<image stem>_…`, and an `.npz` sitting next to the image it
    is named after is a cache by construction.

  * **ai-toolkit** writes `_latent_cache/` and `_t_e_cache/` folders holding
    hash-named `.safetensors`, one pair per directory that contains images. Our
    dataset entries are flat — the project root and each `N_label` repeat folder
    arrive as separate entries (see `dataset_manifest`) — so every folder that
    can hold a cache pair is a dataset path on the request, and a per-entry
    sweep reaches all of them.

  * **musubi-tuner** caches outside the dataset entirely, under
    `<training>/musubi-cache/<arch>/<fingerprint>/`. Those directories are
    deliberately shared between runs whose settings match, so the provider
    records the ones a run actually used and removes only those.

Two things are deliberately *not* fine-grained here. A dataset folder's cache is
removed whole rather than entry-by-entry: the hash-named files can't be mapped
back to settings without reimplementing each backend's key, and everything in
there is a cache of the images in that same folder either way. And a folder
another live job is training on is skipped entirely — the queue is
multi-worker, and pulling the latents out from under a concurrent run fails it.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from dataset_manifest import IMAGE_EXTENSIONS

# ai-toolkit's two per-directory cache folders — `get_latent_path` and
# `_build_text_embedding_path` in toolkit/dataloader_mixins.py.
AI_TOOLKIT_CACHE_DIRS = ("_latent_cache", "_t_e_cache")


def normalise(path: str) -> str:
    """A folder path in the form the skip-set is compared on."""
    return os.path.normcase(os.path.abspath(path))


def _entries(folder: Path) -> list[Path]:
    try:
        return list(folder.iterdir())
    except OSError:
        return []


def _image_stems(folder: Path) -> set[str]:
    """Filename stems of the images directly in `folder`."""
    return {
        p.stem
        for p in _entries(folder)
        if p.is_file()
        and not p.name.startswith(".")
        and p.suffix.lower() in IMAGE_EXTENSIONS
    }


def _names_an_image(cache_stem: str, stems: set[str]) -> bool:
    """Whether `cache_stem` is an image stem plus a suffix the backend added.

    Walks back from the last `_` rather than testing every stem against every
    cache file, so a folder of thousands stays linear. The exact-match case
    covers the legacy SD strategy, whose latents suffix is a bare `.npz`.
    """
    if cache_stem in stems:
        return True
    index = cache_stem.rfind("_")
    while index > 0:
        if cache_stem[:index] in stems:
            return True
        index = cache_stem.rfind("_", 0, index)
    return False


def _remove_file(path: Path) -> bool:
    try:
        path.unlink()
        return True
    except OSError:
        return False


def sweep_image_sidecar_caches(folder: str) -> int:
    """Delete the `.npz` caches sd-scripts wrote beside the images in `folder`.

    Only files that pair with an image go; an `.npz` the user put there
    themselves is left alone. Returns the number of files removed.
    """
    root = Path(folder)
    stems = _image_stems(root)
    if not stems:
        return 0

    removed = 0
    for path in _entries(root):
        if path.suffix.lower() != ".npz" or not path.is_file():
            continue
        if _names_an_image(path.stem, stems) and _remove_file(path):
            removed += 1
    return removed


def remove_tree(path: Path) -> int:
    """Delete a cache directory whole. Returns how many files actually went.

    Errors are swallowed per-file by `rmtree`, so the count is taken from what
    is left rather than assumed — a file held open by a process that hasn't
    finished exiting should be reported as still there, not as removed.
    """
    if not path.is_dir():
        return 0

    def file_count() -> int:
        try:
            return sum(1 for p in path.rglob("*") if p.is_file())
        except OSError:
            return 0

    before = file_count()
    shutil.rmtree(path, ignore_errors=True)
    return before - (file_count() if path.exists() else 0)


def sweep_cache_dirs(
    folder: str, names: tuple[str, ...] = AI_TOOLKIT_CACHE_DIRS
) -> int:
    """Delete the named cache folders directly inside `folder`.

    Returns the number of cached files removed.
    """
    root = Path(folder)
    return sum(remove_tree(root / name) for name in names)
