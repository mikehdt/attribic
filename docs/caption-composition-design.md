# Per-run caption composition

**Status:** UI built 2026-07-30 and verified in the browser; composition itself
not implemented, so the control does not yet change what trains. The ai-toolkit
half is unblocked by the dataset manifests added 2026-07-30
(`training-sidecar/dataset_manifest.py`).

Done: the emission control, its model-derived default, the derive-not-persist
caption mode, and the mismatch advice. Remaining: the wire field, the two
provider composers, cleanup, and the empty-half pre-flight — all listed under
[What this touches](#what-this-touches).

## Problem

A project stores one caption per image, in one of four modes
(`src/app/store/project/types.ts`):

| Mode      | `.txt` contents                                                    |
| --------- | ------------------------------------------------------------------ |
| `tags`    | `1girl, cyberpunk`                                                 |
| `caption` | a natural-language paragraph                                       |
| `hybrid`  | `1girl, cyberpunk, __, A cyberpunk girl is looking at the camera.` |

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

**Composition only ever runs for `hybrid` projects.** For `tags` and `caption`
projects the file on disk already _is_ the only thing the emission could
produce, so there is nothing to compose and nothing to deliver: no inline
captions in the ai-toolkit manifest, no Kohya sidecar files, no cleanup. That
keeps the feature's blast radius to exactly the datasets that asked for it, and
means the old `verbatim` mode is not a mode at all — it is just what happens
when there is nothing to split.

### Composition runs in the sidecar, not on the Node side

An earlier draft put composition on the Node side "where the caption mode and
the tag data already live". Two things make the sidecar the better home:

**The split does not need the caption mode.** The test is entirely local to the
file — does it carry a standalone `__` token? A file that has one is hybrid and
splits; a file that doesn't is whatever it is and passes through untouched.
`hasHybridDelimiter` is the entire decision, so nothing outside the file needs
consulting. Caption mode matters only to the _UI_, to decide which control to
show and what advice to give.

**Node has no I/O here today.** `buildSidecarStartRequest`
(`src/app/services/training/build-sidecar-request.ts`) is synchronous path
arithmetic; composing there would make it async and have it read every `.txt` in
every dataset. The sidecar, meanwhile, already enumerates dataset images
(`list_dataset_images`) and already writes per-run files into the job directory.

So Node sends a resolved `caption_emission` per dataset entry and nothing else.
Captions never travel over the wire, which also retires the request-size
question that a Node-side composer would have raised.

### ai-toolkit: inline in the manifest

Free. `dataset_manifest.py` already writes `{path: {}}` per dataset, and
`load_caption` (`toolkit/dataloader_mixins.py:329`) uses an inline caption only
when the entry carries a `"caption"` key — otherwise it falls back to the `.txt`
sidecar. So:

```json
{ "some\\path\\a.jpg": { "caption": "1girl, cyberpunk" } }
```

No files are written into the dataset folder at all. The empty-value form stays
the default, and is what a file with no delimiter keeps — it means "read the
`.txt`", which for a non-hybrid file is already the right answer.

### Kohya: a run-scoped sidecar extension

sd-scripts derives the caption path from the image path, so the composed text
has to be a real file next to the image. It does not have to be `.txt`:
`caption_extension` is in `DB_SUBSET_ASCENDABLE_SCHEMA`
(`library/config_util.py:211`), so a `[[datasets.subsets]]` entry may carry its
own, and it is appended to the image's basename. Our subsets are
DreamBooth-shaped (`image_dir` + `is_reg`), so this applies.

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

| Architecture                       | Prefers   | Why                                      |
| ---------------------------------- | --------- | ---------------------------------------- |
| `sdxl` (incl. Illustrious, NoobAI) | `tags`    | trained on imageboard tag strings        |
| `anima`                            | `both`    | Qwen3 text encoder, tag-and-prose corpus |
| `zimage`, `flux`                   | `natural` | trained on natural-language captions     |
| `wan`, `ltx`                       | `natural` | same                                     |

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

| Project mode | Control                                            |
| ------------ | -------------------------------------------------- |
| `hybrid`     | three-way segmented control: tags / both / natural |
| `tags`       | static `TagIcon`, muted, with tooltip              |
| `caption`    | static `LetterTextIcon`, muted, with tooltip       |

Only hybrid gets a choice, because only hybrid has two halves to choose
between. The other modes still show their icon: it costs nothing, and it makes
"what will this dataset feed the trainer" answerable at a glance across a
multi-project config — the same job the flip and regularisation icons do on the
folder rows.

**Segmented control, not radios or a dropdown.** Three mutually exclusive
options that all want to be visible at once, on a card that already has a dense
header — `SegmentedControl` (`src/app/shared/segmented-control`) at `size="sm"`.
Radios need three labels and a group heading; a dropdown hides two of the three
options behind a click and reads as a lesser setting than it is.

Icons: `TagIcon` (tags), `CombineIcon` (both), `LetterTextIcon` (natural), each
beside its label. Icon-only segments were the first plan, on the grounds that
three of them fit in the width of the repeats field — but the labels are short,
the header has the room, and a labelled segment needs no `sr-only` companion to
be readable. The static icon shown for a non-hybrid project does still need
one, since there is no visible text beside it.

The auto-resolved default is shown as the selected segment, so the control reads
identically whether the value is inherited or pinned. **Picking the segment that
is already the default clears the pin rather than storing it** — the same
bargain `overrideRepeats` strikes with the detected repeat count
(`folder-row.tsx`, `val === detectedRepeats ? null : val`). Choosing the value
the model would have chosen anyway is not a meaningful pin, and treating it as
one would silently outlive the next model switch. This also removes the need for
a separate reset affordance: the revert is the first segment the user reaches
for anyway.

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

| Project mode       | Model prefers | Note                                                                                          |
| ------------------ | ------------- | --------------------------------------------------------------------------------------------- |
| `tags`             | `natural`     | "This dataset is tagged with keywords, but Z-Image was trained on natural-language captions." |
| `caption`          | `tags`        | converse                                                                                      |
| `tags` / `caption` | `both`        | milder — half of what the model wants is present                                              |
| `hybrid` + pin     | differs       | "You've set tags only, but Z-Image prefers natural language."                                 |

Informational, in the dataset card, never blocking — training a tag-captioned
set into Z-Image is a legitimate thing to do deliberately and a bad thing to do
by accident, and the only difference between the two is whether anyone
mentioned it. Named model where one is selected, "this model" otherwise.

## What this touches

Verified against the code as it stands. Nothing here needs a new subsystem; the
feature lands almost entirely in slots that already exist.

### Client — state and persistence

| File                                           | Change                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `store/training-config/types.ts:11`            | `DatasetSource.captionEmission: CaptionEmission \| null`                    |
| `store/training-config/types.ts:25`            | `DatasetScan.captionMode` — the derived half                                |
| `store/training-config/types.ts:60`            | same override on `ExtraFolder`                                              |
| `store/training-config/index.ts:412`           | `addDataset` seeds `captionEmission: null` and the scanned mode             |
| `store/training-config/index.ts:465`           | `reconcileDatasetFolders` refreshes the mode, clears a now-invalid override |
| `store/training-config/index.ts` (new reducer) | `setDatasetCaptionEmission`                                                 |

Both halves of the persistence design fall out of machinery that is already
there:

- `stripDerived` (`services/training-projects/fs.ts:145`) omits by
  destructuring, on the stated principle that a new field is a user setting
  until someone says otherwise — so `captionEmission` persists with no change.
- It strips `scan` wholesale, so hanging `captionMode` off `DatasetScan` makes
  it derive-not-persist for free.

### Client — reading the mode off disk

`scanDatasetFolders` (`utils/project-actions.ts:606`) returns `{exists,
folders}`; `readConfig` is already in the same module behind
`getProjectCaptionMode` (`:70`), so adding `captionMode` to the scan payload is
a couple of lines and no extra I/O.

For the initial add, `useProjectPicker.selectProject` needs no new fetch either
— `Project` already carries `captionMode` (`utils/project-actions.ts:49`) from
the list call the picker has already made. Without this the card renders modeless
until the first rescan.

### Client — model preference

Lives next to `ARCHITECTURE_LABELS` (`services/training/models.ts:674`) as a map
keyed by `ModelArchitecture`, **not** on `TrainingDefaults`. Everything in
`TrainingDefaults` is a diffable form field with a reset affordance and a
`defaultKey` in the registry; the architecture's caption preference is a fact
about the model, not a knob.

For the same reason there is no new `FIELD_REGISTRY` entry: the control lives
inside the dataset card, already covered by `datasets: { tier: 'simple' }`.
Per-dataset state is not registry state — `overrideRepeats` has no entry either.

### Client — UI

- `sections/dataset/dataset-section.tsx` — the card header row holds the
  control; the advice note sits directly under it.
- `shared/segmented-control/segmented-control.tsx` — `size="sm"`,
  `tone="surface"` (the card is a raised surface).
- `sections/dataset/caption-emission-control.tsx` — a flat file rather than a
  component folder: all the logic is pure and lives in the service module, so
  there is no hook to colocate. Matches `folder-row.tsx` next door.
- `TagIcon` / `CombineIcon` / `LetterTextIcon` — all present in the installed
  lucide.

### Wire format

`SidecarDatasetEntry` (`build-sidecar-request.ts:49`) and `DatasetEntry`
(`training-sidecar/models.py:80`) each gain `caption_emission: str | None`.
`buildDatasets` (`:61`) fans the dataset-level value across that dataset's
folders in the loop it already runs.

### Sidecar — ai-toolkit

`build_manifests` (`dataset_manifest.py:79`) currently writes `{path: {}}` per
image. With an emission it writes `{path: {"caption": composed}}` for files that
carry a delimiter, and leaves `{}` for those that don't — so a mixed folder
degrades per-file rather than all-or-nothing.

Confirmed on the ai-toolkit side: `load_caption`
(`toolkit/dataloader_mixins.py:325`) takes `caption_dict[path]["caption"]` when
the key is present. Note that branch **bypasses both `clean_caption` and the
`default_caption` empty-string fallback** — which is what makes the empty-half
case below a real hazard rather than a cosmetic one.

### Sidecar — Kohya

`generate_config` (`providers/kohya.py:418`) writes `caption_extension = ".txt"`
once under `[general]` (`:450`). Per-subset override is confirmed valid:
`caption_extension` sits in `DB_SUBSET_ASCENDABLE_SCHEMA`
(`library/config_util.py:211`), and our subsets are DreamBooth-shaped
(`image_dir` + `is_reg`), so a `[[datasets.subsets]]` entry may carry its own.

Two adjacent finds in the same schemas, both relevant to the still-open items
below — each would let Kohya do the job with a TOML line instead of composed
files:

- `caption_prefix` / `caption_suffix` (`SUBSET_ASCENDABLE_SCHEMA`, `:186`) —
  trigger words.
- `class_tokens` (`DB_SUBSET_ASCENDABLE_SCHEMA`, `:211`) — regularisation
  class prompts.

### Sidecar — cleanup hooks

- **On start:** the sweep goes in `kohya.generate_config`, which already
  iterates `request.datasets`.
- **On end:** `_run_training` (`job_manager.py:497`) wraps the whole run in
  try/except and holds `job_id`; a `finally` there fires on completion, failure
  and cancellation alike, which is exactly the terminal set
  (`_TERMINAL_TRAINING_STATUSES`, `:31`).

### The empty half

A hybrid asset that has tags but no caption yet composes to `""` under
`natural`. ai-toolkit's inline path skips its `default_caption` fallback, so
that trains an empty caption.

**Warn, never block.** An empty caption is not automatically a mistake: style
training on deliberately bare captions is a real workflow, and there is nothing
to say about an image when the point is the style rather than the content. A
gate here would be the tool second-guessing the user about their own data, in
exactly the case where the user is most likely to be right.

So the pre-flight counts images whose chosen half is empty and says so — it does
not join `canStart` (`training-config-form.tsx`, alongside
`datasetIssues.length === 0`). The assets store already has the shape of the
count in `isAssetTagless` / `selectHasTaglessAssets`
(`store/assets/selectors.ts:169`).

Same reasoning as extra folders below: pass it through and say what you did.

### Not covered

There is no test suite in the repo, so verification is manual — the `verify`
skill drives the browser surface, and a `mock`-provider run exercises the
request path without a GPU.

### Extra folders

A bare folder has no project config, so there is no caption mode to read and no
control to show. They keep today's behaviour: the emission is whatever the model
prefers, and since composition is delimiter-driven, a folder of plain `.txt`
sidecars passes through untouched regardless.

Giving them the full control would mean sniffing each folder for a delimiter —
new server-side I/O for a case that barely arises. Deliberately not done.

## Build order

**ai-toolkit first, Kohya deferred.** The split is worth making because the two
halves have very different risk profiles: the ai-toolkit path writes nothing
into the user's dataset folders at all, so it has no cleanup, no orphans, and
nothing to leave behind when a run dies. Kohya's composed sidecars are the only
part of this design that touches the dataset directory, and they are also the
only part that can be skipped indefinitely if the runs that matter are on
ai-toolkit.

1. Wire field + `caption_compose.py` + inline manifest captions (ai-toolkit).
2. Empty-half pre-flight.
3. Kohya composed sidecars, per-subset `caption_extension`, and cleanup — only
   when a Kohya run actually needs it.

## Still open

- **Trigger words.** Deliberately dropped once already (see the training UI
  review). If it comes back, composition is the natural place for it — prepend
  at emit time, never store it in the file. Kohya can do it without composing
  at all, via the per-subset `caption_prefix`.
- **Regularisation datasets** typically want a bare class prompt rather than the
  image's own caption. The manifest can express that directly for ai-toolkit,
  and Kohya has `class_tokens` per subset — so neither needs the composed-file
  path. It remains the one case that argues for a folder-level caption override,
  so it may reopen "per dataset, not per folder" when it lands.
