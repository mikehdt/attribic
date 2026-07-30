# Per-run caption composition

**Status:** design, not implemented. The ai-toolkit half is already unblocked by
the dataset manifests added 2026-07-30 (`training-sidecar/dataset_manifest.py`).
UI design resolved 2026-07-30.

## Problem

A project stores one caption per image, in one of four modes
(`src/app/store/project/types.ts`):

| Mode        | `.txt` contents                                                    |
| ----------- | ------------------------------------------------------------------ |
| `tags`      | `1girl, cyberpunk`                                                 |
| `sentences` | tag-ish phrases, comma separated                                   |
| `caption`   | a natural-language paragraph                                       |
| `hybrid`    | `1girl, cyberpunk, __, A cyberpunk girl is looking at the camera.` |

Hybrid exists because a dataset is worth captioning once and training many
times. But different architectures want different things out of it — Z-Image
wants the natural-language half, SDXL-family models were trained on
imageboard-style tags and do better with the tag half. Today the trainer gets
the file verbatim, so a hybrid project trains both halves into every model, plus
a literal `__` token: ai-toolkit's `clean_caption`
(`toolkit/dataloader_mixins.py:96`) is entirely commented out and returns its
input unchanged, and sd-scripts likewise reads the sidecar as-is.

So the caption a run trains on should be a property of **the run**, composed at
launch, not of the file on disk.

## The constraint that shapes everything

The `.txt` sidecar is owned by the tagging UI. It is the user's data, it is what
the grid displays and edits, and it is the only copy. Composing _into_ it for a
run — the obvious approach — means:

- the file is transient during training, so the UI shows a filtered subset
- a crash or a cancel mid-run leaves it holding that subset permanently
- two concurrent runs wanting different modes cannot both be right

Renaming the canonical file to `*.attr.txt` and generating `.txt` per run has
the same failure on the write path, and additionally breaks every existing
project until migrated.

**The canonical `.txt` must never be written by a training run.**

## Design

Compose per run, deliver out-of-band. Each provider already has a mechanism.

### Emission modes

A run picks what the trainer sees:

| Emission  | Composed from a `hybrid` file            |
| --------- | ---------------------------------------- |
| `tags`    | tag block only, `__` and caption dropped |
| `natural` | caption only, tag block dropped          |
| `both`    | tag block, then the caption              |

For `both`, the whole `, __, ` separator collapses to a single `, ` — the
delimiter token is removed, not substituted, so there is no doubled or dangling
comma:

```
1girl, cyberpunk, __, A cyberpunk girl looks at the camera.
→ 1girl, cyberpunk, A cyberpunk girl looks at the camera.
```

`splitHybrid` (`src/app/store/assets/hybrid-caption.ts:45`) already does the
parse, and returns the two halves already trimmed, so joining them with `', '`
gives exactly this. Empty halves collapse cleanly too: a hybrid asset with no
caption yet emits the tag block with no trailing separator.

**Composition only ever runs for `hybrid` projects.** For `tags`, `sentences`
and `caption` projects the file on disk already _is_ the only thing the emission
could produce, so there is nothing to compose and nothing to deliver: no inline
captions in the ai-toolkit manifest, no Kohya sidecar files, no cleanup. That
keeps the feature's blast radius to exactly the datasets that asked for it, and
means the old `verbatim` mode is not a mode at all — it is just what happens
when there is nothing to split.

Composition happens on the Node side at launch, where the caption mode and the
tag data already live, and rides in the sidecar request per dataset entry.

### ai-toolkit: inline in the manifest

Free. `dataset_manifest.py` already writes `{path: {}}` per dataset, and
`load_caption` (`toolkit/dataloader_mixins.py:329`) uses an inline caption only
when the entry carries a `"caption"` key — otherwise it falls back to the `.txt`
sidecar. So:

```json
{ "some\\path\\a.jpg": { "caption": "1girl, cyberpunk" } }
```

No files are written into the dataset folder at all. The empty-value form stays
the default, meaning `verbatim`.

### Kohya: a run-scoped sidecar extension

sd-scripts derives the caption path from the image path, so the composed text
has to be a real file next to the image. It does not have to be `.txt`:
`caption_extension` is a per-subset option (`library/config_util.py:86,213,229`)
and is appended to the image's basename.

So the run writes `foo.<ext>` beside `foo.jpg`, points the TOML at `<ext>`, and
deletes them when the job reaches a terminal state.

## Naming the Kohya sidecars

Two candidates, both workable:

**`.sdscripts.txt`** — provider-scoped, so a hypothetical third backend needing
its own sidecar gets its own name. Trivially sweepable. Self-healing, since each
run rewrites every file. Fails only under concurrency: two runs training the
same folder with different emissions on different GPUs would fight over one
filename, and the loser trains on the winner's captions.

**`.<job-id>.txt`** — collision-free by construction. Our job IDs are minted on
our side (`training-sidecar/job_manager.py:371`, `uuid4().hex[:12]`) before
`generate_config` is called, so there is no chicken-and-egg with the provider:
ai-toolkit's own job id is a separate thing assigned later and is not involved.

**Recommendation: combine them** — `.attribic-<job-id>.txt`, e.g.
`portrait-01.attribic-a588e5f13005.txt`.

The stable `attribic-` prefix is what makes orphans sweepable without knowing
job IDs (`*.attribic-*.txt`), and the job ID is what makes concurrent runs on a
shared dataset safe. The queue is already multi-worker by design
(`sidecarWorkers` in config.json), and "train the same set two ways at once" is
exactly the experiment this feature invites, so the concurrency case is worth
designing for rather than discovering.

Not `.txt`-suffixed-only names like `foo.attribic.txt` without an ID: same
collision problem as `.sdscripts.txt`, no benefit.

## Cleanup

Composed sidecars are garbage the moment a job is terminal.

- **On job end** (completed, failed, cancelled): delete this run's files by
  exact extension. Cheap and covers the normal path.
- **On job start**: sweep `*.attribic-*.txt` in each dataset folder whose job ID
  is not an active job. Covers the sidecar being killed mid-run, which the
  on-end hook cannot.

Both are flat per-folder scans — the dataset folders are already enumerated by
`dataset_manifest.list_dataset_images`.

Worth noting these files land in the user's dataset folder, unlike the
ai-toolkit path. That is unavoidable given how sd-scripts resolves captions, and
is the reason cleanup is a first-class part of this design rather than an
afterthought.

## Model preference

Each architecture wants one of the three emissions. This is a property of what
the model was trained on, so it lives next to the model definition
(`src/app/services/training/models.ts`, keyed off `architecture`):

| Architecture              | Prefers   | Why                                     |
| ------------------------- | --------- | --------------------------------------- |
| `sdxl` (incl. Illustrious, NoobAI) | `tags`    | trained on imageboard tag strings       |
| `anima`                   | `both`    | Qwen3 text encoder, tag-and-prose corpus |
| `zimage`, `flux`          | `natural` | trained on natural-language captions    |
| `wan`, `ltx`              | `natural` | same                                    |

## Where it lives

**Per dataset, not per folder.** Caption mode is a property of the tagging
project, and every folder inside a project shares it, so a per-folder control
would ask the same question N times and invite an answer ("tags for `5_close`,
natural for `10_wide`") that has no coherent meaning. The dataset card header —
next to the project name and thumbnail — is the one place it is asked. Extra
folders carry their own, since a bare folder is its own dataset.

Wire-side this is still per-subset: `buildDatasets`
(`src/app/services/training/build-sidecar-request.ts:62`) already fans a
dataset's settings out across its folders, so one dataset-level value lands on
every entry without any new plumbing.

### Stored as an override, not a value

```ts
type DatasetSource = {
  // ...
  /** null = follow the selected model's preference. */
  captionEmission: CaptionEmission | null;
};
```

Same shape as `overrideRepeats`, for the same reason. A stored concrete value
goes stale the moment the user switches the model: pick Z-Image after a config
was built for SDXL and a pinned `tags` would quietly keep training the tag half
into an NL model. With `null` as the default, switching model re-resolves every
un-pinned dataset for free, and the only value ever persisted is one the user
actually chose.

### The control

Rendered from the project's **current** caption mode:

| Project mode           | Control                                              |
| ---------------------- | ---------------------------------------------------- |
| `hybrid`               | three-way segmented control: tags / both / natural   |
| `tags`, `sentences`    | static `TagIcon`, muted, with tooltip                |
| `caption`              | static `LetterTextIcon`, muted, with tooltip         |

Only hybrid gets a choice, because only hybrid has two halves to choose
between. The other modes still show their icon: it costs nothing, and it makes
"what will this dataset feed the trainer" answerable at a glance across a
multi-project config — the same job the flip and regularisation icons do on the
folder rows.

**Segmented control, not radios or a dropdown.** Three mutually exclusive
options that all want to be visible at once, on a card that already has a dense
header — `SegmentedControl` (`src/app/shared/segmented-control`) at `size="sm"`
renders them icon-only in about the width of the repeats field. Radios need
three labels and a group heading; a dropdown hides two of the three options
behind a click and reads as a lesser setting than it is.

Icons: `TagIcon` (tags), `CombineIcon` (both), `LetterTextIcon` (natural).
Icon-only segments, so each needs a `title` and an `sr-only` label.

The auto-resolved default is shown as the selected segment — the control reads
identically whether the value is inherited or pinned. A pinned value that
differs from the model's preference gets a small reset affordance, matching how
`overrideRepeats` reverts to the detected value.

## When the project's caption mode changes

A saved training config outlives the projects it points at. Retag a project from
`hybrid` to `caption` and any stored `tags` emission becomes unsatisfiable:
composing it yields empty captions for every image, and the run trains on
nothing without failing.

**Caption mode is derived, never persisted into the training config.** It joins
`imageCount` and `detectedRepeats` in `stripDerived` / `DatasetScan`
(`src/app/store/training-config/types.ts:25`) — read at load, refreshed by the
existing rescan button, and read again at launch. A config that is trained
straight from disk without ever opening the form therefore resolves against
today's project, not the project as it looked when saved. That is the whole
reason for deriving it rather than storing it.

Then, on load or rescan:

- If the stored override is still valid for the current mode, keep it.
- If it is not (any pin on a project that is no longer `hybrid`), **clear it to
  `null` and note it in the dataset card** — "This project is now
  natural-language only; the tags-only setting no longer applies."

Clear-and-tell rather than block, because falling back to auto is always the
correct answer here: a non-hybrid project has exactly one possible emission, and
auto resolves to it. There is nothing for the user to decide, only something for
them to know. The blocking treatment that missing folders get
(`dataset-issue-warning.tsx`) would be theatre.

## Advice on mismatches

The same resolution step knows when a dataset simply cannot give the model what
it wants, which is worth saying out loud:

| Project mode        | Model prefers | Note                                                                 |
| ------------------- | ------------- | -------------------------------------------------------------------- |
| `tags`, `sentences` | `natural`     | "This dataset is tagged with keywords, but Z-Image was trained on natural-language captions." |
| `caption`           | `tags`        | converse                                                              |
| `tags` / `caption`  | `both`        | milder — half of what the model wants is present                      |
| `hybrid` + pin      | differs       | "You've set tags only, but Z-Image prefers natural language."         |

Informational, in the dataset card, never blocking — training a tag-captioned
set into Z-Image is a legitimate thing to do deliberately and a bad thing to do
by accident, and the only difference between the two is whether anyone
mentioned it. Named model where one is selected, "this model" otherwise.

## Still open

- **Trigger words.** Deliberately dropped once already (see the training UI
  review). If it comes back, composition is the natural place for it — prepend
  at emit time, never store it in the file.
- **Regularisation datasets** typically want a bare class prompt rather than the
  image's own caption. The manifest can express that directly for ai-toolkit;
  Kohya would need the same composed-sidecar path. This is the one case that
  argues for a folder-level caption override, so it may reopen "per dataset,
  not per folder" when it lands.
- **Request size.** Composed captions ride in the launch request one per image.
  Fine at the hundreds-to-low-thousands scale a LoRA dataset usually runs to; if
  a hybrid dataset ever reaches tens of thousands of images, the split is
  trivial enough to push into `dataset_manifest.py` and send only the emission
  mode.
