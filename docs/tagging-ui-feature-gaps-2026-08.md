# Tagging UI Feature Review — 2026-08

A "what may I have missed that's obvious?" review of the tagging UI against comparable
dataset-preparation tools. Not aiming to replicate any other system — just cataloguing
good ideas worth considering. Two inputs: a full feature inventory of our own tagging
surface, and external research across the tools the LoRA-training community actually
uses (TagGUI, BooruDatasetTagManager, dataset-tag-editor, Hydrus, OneTrainer,
DatasetHelpers, Candy Machine, dagger, kohya_ss).

Status: research + direction notes. Nothing here is committed to build.

---

## 1. Where we already meet or beat the field

Most of what the category considers table stakes is covered, sometimes in stronger form
than the reference tools:

- **Batch tag operations scoped by filter/selection** — Add Tags, Edit Tags
  (rename-everywhere with collision handling), delete-toggle across scope, Gather Tags,
  Copy Tags donor/recipient modal. The universal operation set, and our
  scoping-checkboxes + "will apply to N assets" model is cleaner than most.
- **Filter-then-batch as the core loop** — Any/All/Inverse per filter class (tags, name,
  sizes, buckets, extensions, subfolders, trigger words), scope flags (tagless,
  selected, modified), live counts. Comparable to dataset-tag-editor's model, which
  built its whole UX around this.
- **Tag frequency counts** — global counts on every chip and in the filter panel's
  count-sorted tag list. Covers what BDTM/dagger/Hydrus do with dedicated tag panels.
- **Auto-tagging** — WD14-family ONNX with dual thresholds and include/exclude lists,
  plus local VLM captioning with prompt templating, trigger injection, and video
  support. Results staged as unsaved TO_ADD — which *is* the review-before-apply step
  BDTM ships as a separate preview tab.
- **Trigger-word support** — project trigger phrases, highlight/glow, filter class,
  prompt injection, prepend-on-add. The community's `keep_tokens` conventions are served.
- **Caption / hybrid / tags modes** with mode-switch reconciliation — most tools have
  tags or captions, not a managed hybrid.

## 2. Gaps worth considering (ranked)

### 2.1 Tag autocomplete — highest value-to-effort

We have no autocomplete anywhere. It's in essentially every comparable tool (TagGUI,
BDTM, Hydrus, and the a1111 tagcomplete convention that BDTM reuses). Two complementary
sources:

1. **The project's own tags** (the big win): suggest from `tagCountsCache`, ranked by
   frequency. Enforces internal consistency — exactly what the community's "tag
   consistently or the model learns noise" advice is about — and kills typo-variants
   before they exist. TagGUI does exactly this (own-dataset most-used tags).
2. **Booru CSV vocabularies** (optional, later): danbooru tag lists with post counts,
   for keeping vocabulary aligned with booru-trained bases. A per-project opt-in, since
   it only makes sense for some base models.

**Direction: build once, use everywhere.** One shared autocomplete primitive, applied
coherently across every tag entry surface rather than bolted onto one input:

- per-asset add-tag input (`input-tag.tsx`)
- Add Tags modal multi-tag chip input (`shared/multi-tag-input`)
- Edit Tags modal rename fields
- auto-tagger Always Include / Exclude chip inputs
- trigger phrases modal
- filter panel tag search (already a filtered list — could share ranking, not popup)

We already have listbox-ish keyboard machinery (`use-list-highlight`,
`use-keyboard-navigation`) to build the suggestion popup on.

### 2.2 Keyboard-driven review loop

The research is blunt: per-image seconds dominate total prep time, and TagGUI's
keyboard-first flow is its most-cited selling point. We have good keyboard support
*inside* widgets but no global layer — no next/previous asset, no "focus tag input of
current asset", no save hotkey, no jump-to-first-untagged (TagGUI: Ctrl+J), no `?`
shortcuts overlay.

**Direction: leverage the training UI's existing model.** The samples lightbox
(`shared/activity-panel/training-detail-modal/samples-lightbox/`) already demonstrates
the pattern: a focused container owning arrow-key 2D navigation with per-direction
dead-end awareness, Esc handled locally with propagation stopped so it unwinds one
layer at a time, and a local Tab trap. Generalising that into a "current asset" roving
focus over the gallery gives:

- ↑/↓ (or j/k) move the current asset; a key to focus its tag input; Esc back out to
  navigation level
- jump-to-first-untagged (we already know taglessness; the Tagless filter is the
  manual version)
- cross-page navigation can reuse the category-navigation `#anchor` + scroll machinery
- `?` overlay listing bindings

### 2.3 Find & replace across tag/caption text

We have whole-tag rename (Edit Tags) but no substring/regex replace. dataset-tag-editor
(regex, comma-aware), TagGUI (Ctrl+R), kohya, and DatasetHelpers all ship it. It matters
more now that caption and hybrid modes exist: **there is currently no bulk edit path for
caption text at all** except re-running the VLM. Fixing a repeated phrase the captioner
loves ("The image shows…") across 200 captions is the canonical case. Scoped by the same
selected/filtered checkboxes as every other bulk op; preview-of-matches before apply
fits our staged-edit model (changes land dirty, saved via Save All).

### 2.4 Delete (and rename) images from the UI

Verified absent — no delete-image action or API route at all. Every workflow guide puts
culling *before* tagging ("quality > quantity"); every comparable tool has a discard
flow (DatasetHelpers gallery culling, dagger subset export, Hydrus). Today culling means
alt-tabbing to Explorer and refreshing.

A reversible **delete-to-`.trash`-subfolder** would close this cheaply: the move-modal
machinery already handles sidecar pairing (`.txt`, `.poster.jpg`, latent/TE caches),
collision checks, and Windows retry. Rename-image is a lesser nice-to-have.

### 2.5 Grid view + quick comparison

We only have the full-width row list. A compact grid mode is what makes culling and
"does this dataset look coherent?" passes fast — and it pairs naturally with 2.4.

**Direction: leverage the training samples grid, and combine with existing grouping.**

- `samples-grid` demonstrates the layout model (equal `1fr` tracks with a floor,
  `display: contents` rows, horizontal scroll past the floor); `samples-lightbox`
  demonstrates the compare/inspect overlay with arrow navigation between neighbours.
- Category grouping already exists (sort-derived groups with sticky headers +
  jump-to-category). A grid view grouped by subfolder — see all images within a folder
  as a block — falls out of the same category model.
- Quick comparison: the lightbox's "arrow between neighbouring cells in place"
  interaction is the comparison primitive; a select-two-and-compare view could come
  later if needed.
- **The tricky part is keeping the UI reasonable.** The toolbar is already dense; a
  view switcher must not fork every control. Likely shape: one list/grid toggle where
  grid reuses the same sort/filter/selection state, hides the per-asset tag editor, and
  keeps selection + metadata-footer actions. Editing stays in list view (or via a
  lightbox overlay); grid is for looking, culling, selecting.

### 2.6 Token counter (lower priority for us)

TagGUI's much-cited unique feature: live SD token count per caption plus `tokens:>75`
filtering to find encoder-chunk-boundary offenders. We show a word count in the caption
editor. Relevance varies by base model — matters for CLIP-encoder-era models (SDXL),
less for the T5/LLM-encoder models we mostly train — so worthwhile, not urgent, and
would need per-model tokenizer awareness to be honest rather than approximate.

## 3. Worth a thought, lower priority

- **Undo for bulk operations.** Conspicuously weak across the entire category — nobody
  really has it, so it's a differentiator, not table stakes. Our staged
  TO_ADD/TO_DELETE/DIRTY model already covers pre-save regret; the hole is post-Save-All
  regret after a bulk op. Even a one-shot "snapshot sidecars before Save All / restore
  last snapshot" covers most of it.
- **Duplicate image detection** (perceptual hash — Hydrus is the reference). Useful for
  scraped datasets; skippable for hand-curated ones.
- **Saved filter presets.** The filter model is elaborate and entirely in-memory; a
  named-preset dropdown would suit power use. Minor.

## 4. Considered and skipped

- **Dedicated tag-statistics view** — the count-sorted filter-panel tag list already
  finds rare/garbage tags (sort ascending). A histogram view adds little.
- **Review-before-apply for auto-tagging** — TO_ADD staging already is one, arguably
  better than BDTM's separate preview tab.
- **Trigger-word-first enforcement** — covered by prepend-on-add, Shift+Enter prepend,
  Gather Tags, and VLM trigger injection.
- **Tag aliases/implications (Hydrus siblings/parents), weighted tags, mask editing,
  tag translation** — each is single-tool territory or serves a niche we don't occupy.

---

## Appendix A — comparable tools surveyed

| Tool | Distinctive tagging-UX features |
|---|---|
| **TagGUI** (jhc13) | Keyboard-first (Ctrl+J jump-to-untagged, Alt focus keys); drag tag reorder; Find & Replace; Batch Reorder Tags; query filter language (`tag:`, `tokens:>75`, wildcards, AND/OR/NOT); own-dataset autocomplete; SD token counter; VLM + WD captioning with templating |
| **BooruDatasetTagManager** | Three-panel layout with dataset-wide tag list; booru CSV autocomplete (post counts); multi-model auto-tag with preview tab; weighted tags; tag translation; configurable hotkeys |
| **dataset-tag-editor** (a1111 ext.) | Filter-then-batch as core model (AND/OR, positive/negative); regex search & replace; batch sort tags across filtered set; many interrogators |
| **Hydrus Network** | Autocomplete with collection counts; namespaced tags with colours; tag siblings/parents (aliases/implications); perceptual-hash dedupe; fully keyboard-drivable tag dialog |
| **OneTrainer CaptionUI** | Arrow-key file navigation; save-on-Enter; batch caption with prefix/postfix; mask editing (brush + ClipSeg/Rembg auto-mask) for masked training |
| **DatasetHelpers** | Gallery culling + bulk low-res discard; YoloV4 content-aware crop; consolidate-similar-tags; subset extraction by tag search |
| **Candy Machine** | Per-project tag template/categories for consistency; suggest-don't-apply autotags; crop/rotate/flip; completion pie chart; `?` overlay |
| **dagger** | Live tag list with occurrence counts, click-to-filter (Ctrl = negative); Ctrl+A select-all-filtered; ZIP export of filtered subset |
| **kohya_ss utilities** | Batch caption tabs; WD14 dual thresholds + undesired-tags list; prefix/postfix trigger insertion; find-and-replace across caption files |

Community workflow conventions these serve: trigger token first (`keep_tokens`); prune
intrinsic-trait tags so they absorb into the trigger; consolidate to umbrella tags;
autotag at 0.35–0.75 then hand-refine; cull before tagging; "tag what you want to be
able to change".

## Appendix B — internal reference points

- Keyboard/lightbox model: `src/app/shared/activity-panel/training-detail-modal/samples-lightbox/samples-lightbox.tsx`
- Grid layout model: `src/app/shared/activity-panel/training-detail-modal/samples-grid/samples-grid.tsx`
- Listbox keyboard machinery: `src/app/shared/popup/use-list-highlight.ts`, `src/app/tagging/components/top-shelf/filter-list/use-keyboard-navigation.ts`
- Tag counts (autocomplete source): `src/app/store/assets/selectors.ts` (`selectTagCounts`)
- Tag entry surfaces for shared autocomplete: `src/app/tagging/components/tagging/input-tag.tsx`, `src/app/shared/multi-tag-input/`, edit-tags modal, auto-tagger include/exclude inputs, trigger phrases modal
- Sidecar-aware file ops (basis for delete-to-trash): `src/app/utils/asset-actions.ts`, move-to-folder modal
- Category grouping (basis for folder-grouped grid): `src/app/tagging/utils/category-utils.ts`, category-navigation

## Sources

- https://github.com/jhc13/taggui
- https://github.com/starik222/BooruDatasetTagManager
- https://github.com/toshiaki1729/stable-diffusion-webui-dataset-tag-editor
- https://hydrusnetwork.github.io/hydrus/getting_started_tags.html
- https://github.com/Nerogar/OneTrainer/blob/master/docs/CaptioningAndMasking.md
- https://github.com/Particle1904/DatasetHelpers
- https://github.com/mikeknapp/candy-machine
- https://github.com/kznrluk/dagger
- https://deepwiki.com/bmaltais/kohya_ss/5.1-image-captioning
- https://rentry.co/ltflora (LoRA tagging FAQ)
- https://github.com/Marcus-Arcadius/a1111-sd-webui-tagcomplete
