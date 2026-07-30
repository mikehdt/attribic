"""Compose the caption a run trains on from a hybrid `.txt` sidecar.

A hybrid caption stores imageboard-style tags and a natural-language caption in
one file, separated by a standalone `__` token:

    1girl, cyberpunk, __, A cyberpunk girl looks at the camera.
    └────────── tags ─────────┘ ↑  └──────────── caption ─────────┘
                         delimiter

Different architectures want different halves of that — SDXL-family models were
trained on tag strings, Z-Image on prose — so which half a run trains on belongs
to the run, not to the file. The `.txt` is the tagging UI's data and the only
copy of it, so nothing here ever writes to it: composition happens at launch and
is delivered out of band (see `docs/caption-composition-design.md`).

This is a port of `src/app/store/assets/hybrid-caption.ts`. The delimiter format
is defined there; keep the two in step.

The split is decided entirely by the file's own content. A file with no
delimiter is not hybrid, so every emission returns it unchanged — which is what
makes this safe to apply to every dataset without knowing the project's caption
mode.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

# The delimiter token, as it appears as its own comma-delimited entry. Single
# underscores are how booru tags encode spaces (`long_hair`), so a bare `__`
# can never collide with a real tag.
HYBRID_DELIMITER = "__"

SEPARATOR = ", "

CaptionEmission = Literal["tags", "both", "natural"]


def split_hybrid(raw: str) -> tuple[str, Optional[str]]:
    """Split a raw caption into `(tag_block, caption)`.

    Splits on the *first* delimiter token only, so a stray `__` inside the prose
    is left alone.

    The caption is `None` when there is no delimiter and `""` when there is one
    with nothing after it. That distinction is the whole point of this function:
    "this file is not hybrid, leave it alone" and "the natural-language half of
    this hybrid file is empty" call for opposite behaviour, and collapsing them
    into a falsy caption makes an emission silently fall back to the other half.
    The TypeScript `splitHybrid` deliberately does collapse them — it is parsing
    for an editor, where an uncaptioned hybrid file and a tags file should look
    the same.
    """
    parts = raw.split(SEPARATOR)

    delimiter_index = next(
        (i for i, part in enumerate(parts) if part.strip() == HYBRID_DELIMITER),
        -1,
    )
    if delimiter_index == -1:
        return raw.strip(), None

    tag_block = SEPARATOR.join(parts[:delimiter_index]).strip()
    # Rejoin the tail with the original separator so commas inside the prose
    # survive the round trip.
    caption = SEPARATOR.join(parts[delimiter_index + 1 :]).strip()
    return tag_block, caption


def compose(raw: str, emission: Optional[str]) -> str:
    """The text a run trains on for one image.

    `both` drops the delimiter rather than substituting it, so the two halves
    are joined by a single `, ` with no doubled or dangling comma. An emission
    of None (or an unrecognised one) leaves the file untouched.
    """
    if emission not in ("tags", "both", "natural"):
        return raw

    tag_block, caption = split_hybrid(raw)

    # No delimiter: not a hybrid file, so there are no halves to choose
    # between and every emission is the file itself.
    if caption is None:
        return tag_block

    if emission == "tags":
        return tag_block
    if emission == "natural":
        # May be "" — a hybrid file that has not been captioned yet. Returning
        # the tag block instead would quietly train the opposite of what was
        # asked for; the caller counts these and says so.
        return caption
    # `both` — either half may be empty, so filter before joining.
    return SEPARATOR.join(half for half in (tag_block, caption) if half)


def read_caption(image_path: str) -> Optional[str]:
    """The `.txt` sidecar beside an image, or None when there isn't one.

    Absent and unreadable are deliberately the same answer: the caller's job is
    to leave the entry alone so the trainer falls back to its own sidecar
    lookup, and a half-composed run is worse than an uncomposed one.
    """
    sidecar = Path(image_path).with_suffix(".txt")
    try:
        return sidecar.read_text(encoding="utf-8")
    except OSError:
        return None


def compose_for_image(image_path: str, emission: Optional[str]) -> Optional[str]:
    """The composed caption for one image, or None to leave it to the trainer.

    None means "no opinion" — no sidecar, or nothing that composition would
    change. Returning the file's own text instead would be equivalent but would
    inline a caption for every image in every dataset, which buries the entries
    that actually differ.
    """
    if emission is None:
        return None

    raw = read_caption(image_path)
    if raw is None:
        return None

    composed = compose(raw, emission)
    return composed if composed != raw.strip() else None
