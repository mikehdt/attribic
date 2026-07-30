# Tag-frequency metadata for ai-toolkit LoRAs — design

Status: **design only, not committed to build** (Mike, 2026-07-12)

Design for embedding `ss_tag_frequency` metadata into LoRAs produced by the ai-toolkit
(Ostris) backend, so tools like Forge / NeoForge / A1111 and the standalone LoRA metadata
viewer show a "top tags" / suggested-prompt panel — matching the behaviour of Kohya
sd-scripts LoRAs.

## Motivation

Kohya sd-scripts writes a large block of `ss_*` training metadata into the safetensors
header, including **`ss_tag_frequency`** — a nested JSON tally of how often each caption tag
appeared in the dataset:

```json
{ "10_mydataset": { "1girl": 40, "blue_eyes": 33, "smiling": 21 } }
```

Forge and similar UIs read that key to populate the LoRA card's tag list, giving the user a
cheat-sheet of what to prompt with. ai-toolkit writes only minimal metadata (mostly
`modelspec.*` SAI keys — architecture, resolution), so its LoRAs show a blank tag panel.

Key framing (established during design discussion):

- This is **cosmetic metadata, not training data.** The tag frequency is never read by the
  model at inference — it's a human-facing annotation. The trained weights from ai-toolkit
  are exactly as tag-responsive as Kohya's; only the convenience readout is missing.
- The caption `.txt` files the user already authored _are_ the source of truth; we're just
  surfacing a summary of them into the file's header.
- Kohya already writes this natively. This feature is **ai-toolkit-only.**

## Scope

**In scope (v1):** `ss_tag_frequency` only.

**Explicitly out of scope:** the rest of the `ss_*` family (`ss_dataset_dirs`,
`ss_network_dim`, `ss_optimizer`, training time, etc.). ai-toolkit LoRAs look sparse in
rich viewers beyond the tag panel, but "full Kohya-parity metadata normalisation" is a
separate, larger item. Keeping v1 to the single key that drives the headline "top tags"
display prevents the checkbox from quietly becoming a much bigger promise.

## UX / field placement

Exposed as a single boolean form field, wired like any other tier-gated hyperparameter
(mirrors `lowVram`).

- **Default: `true`.** Non-destructive (metadata only, never touches weights) and makes an
  ai-toolkit LoRA behave like a Kohya one in Forge — so the good behaviour is free. No
  quality footgun.
- **Visibility: Intermediate tier.** A Simple-tier user never has to reason about
  safetensors headers — they just get the populated tag panel. The knob only appears from
  Intermediate up, for those who want it _off_.
- **Provider-gated to `ai-toolkit`.** Hidden entirely under Kohya (redundant there).

Tier controls _visibility only_, not the value — so "on by default for Simple" and
"toggleable from Intermediate" are the same field, not a conflict.

Two legitimate reasons a user turns it off (justifying the off-switch existing):

1. **Privacy** — tag frequency exposes the dataset's contents; someone publishing a LoRA may
   strip metadata first.
2. **Redundant on Kohya** — hence hidden, not merely disabled, under that backend.

### TS wiring touchpoints

| File                                         | Change                                                                                                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `services/training/field-registry.ts`        | `embedTagFrequency: { tier: 'intermediate', group: 'saving', defaultKey: 'embedTagFrequency', providers: ['ai-toolkit'] }` |
| `store/training-config/types.ts`             | add `embedTagFrequency: boolean`                                                                                           |
| `store/training-config/defaults.ts`          | default `true`                                                                                                             |
| `store/training-config/index.ts`             | setter action (mirror `setLowVram`)                                                                                        |
| `sections/saving-section.tsx`                | render the checkbox (tier + provider gating come free from the registry)                                                   |
| `services/training/build-sidecar-request.ts` | map into `hyperparameters.embed_tag_frequency`                                                                             |

Suggested label, framed around the payoff: **"Embed dataset tags in metadata"**, hint
_"Lets Forge / A1111 show suggested tags for this LoRA."_

## Injection strategy (sidecar / Python)

All work happens in `providers/ai_toolkit_ui.py` during the run, gated on
`hp.get("embed_tag_frequency")`. Proposed helper module: `training-sidecar/tag_frequency.py`
(pure stdlib — `struct` + `json` — so it's unit-testable in isolation and doesn't bloat the
provider).

### Why incremental, not batch-at-end

The obvious spot is the terminal block (after the pid-exit wait, when the final save has
landed). But injecting _only_ there has two problems:

1. **Cancelled / crashed runs** would leave every already-written checkpoint un-tagged.
2. **Write burst.** A small dataset trained for hundreds of epochs at one-save-per-epoch would
   rewrite hundreds of files in a single stall at the end. Because safetensors stores metadata
   in the length-prefixed header, _any_ metadata change shifts the tensor blob and forces a
   **full-file rewrite** — there is no in-place patch. Hundreds of ~200 MB rewrites in one hit
   is a real stall; spread across the run it's negligible.

So: inject each checkpoint shortly after it's written, and use the terminal block only for the
final save + as a backstop.

### The file-handle race — ai-toolkit still writing

The provider already detects new checkpoints each poll via the directory diff
(`new_files = current_files - seen_checkpoints`, ~lines 489–498). The 1 s poll can catch a
large safetensors **mid-write**, while ai-toolkit still holds the handle. Reading it then would
get a partial/corrupt file.

Note the collision is _not_ two writers deadlocking on one path — our injection never opens the
checkpoint for in-place writing. It is **read whole file → write a fresh temp → `os.replace()`**.
The only failure mode is reading a file ai-toolkit hasn't finished writing. Guard it with a
**settle check** instead of injecting on first sight:

- Track `pending: {path → last_seen_size}`.
- Each poll, for any not-yet-injected checkpoint, `stat` its size. If the path is in `pending`
  with an **unchanged size** since the previous poll → the write has completed; inject and mark
  done. Otherwise record the size and reconsider next poll.

The one-poll delay plus size-stability covers writes that span more than one poll. On Windows,
`os.replace` onto the target is safe because ai-toolkit never reopens an _old_ checkpoint — only
the one currently being written, which the guard has already excluded.

### Division of labour

- **Intermediate checkpoints** → injected mid-run via the settle guard, spread out.
- **Final save** → injected in the terminal block _after_ the existing pid-exit wait (~lines
  552–581). The process is fully gone by then, so that file is unambiguously safe — no settle
  check needed.
- **Cancellation (`stopped`)** → hits the same terminal block, so intermediates are already done
  and the final/backstop sweep covers the rest.
- **Backstop** → the terminal block injects any checkpoint still un-injected (e.g. a save that
  landed on the very last poll and never got its settle cycle).

Tag counting runs **once** and is cached; only the per-file rewrite repeats per checkpoint.

### Tag counting

Walk each `ds.path` in `request.datasets`, read every sibling `*.txt`, split on `,`, strip
whitespace, tally. Produce one sub-dict per dataset folder keyed by folder name, mirroring
Kohya's `{ "<dir>": { tag: count } }` layout (Forge sums across dirs, so the key naming is
cosmetic). Tags are left verbatim — no underscore/space transform.

### Safetensors header surgery

Do **not** use `safetensors.torch.save_file` — these LoRAs are float8/float16 quantised and a
re-save risks round-tripping the tensors. Instead, raw header rewrite keeps tensor bytes
byte-identical:

1. Read the 8-byte little-endian header length (`<Q`).
2. Read + parse that many bytes of JSON header.
3. Merge `ss_tag_frequency` into `header["__metadata__"]` — value must be a JSON **string**
   (all metadata values are strings).
4. Re-serialise the header, write `new_len + header + original_tensor_blob` to a temp file,
   then atomic-replace.

Best-effort throughout: any read/parse/write/stat failure on a single file is logged and
swallowed. A metadata hiccup must never fail an otherwise-successful training run. Files pruned
by ai-toolkit's `max_step_saves_to_keep` between detection and injection simply fail the stat
and are skipped.

## Open questions / deferred

- Full `ss_*` parity for the rich metadata-viewer dashboard — separate, larger effort.
- Whether to also count/emit for Kohya (no — it writes this natively).
- Hand-placed / externally-produced ai-toolkit LoRAs (trained outside this app) get no
  retroactive tagging; out of scope — this only touches jobs we run.
