# Training UI Design

## Design Principles

1. **Model-first**: Everything cascades from the model choice. Defaults, available options, and validation all derive from the selected architecture.
2. **Progressive disclosure**: Simple by default, powerful when needed. Most users shouldn't need to scroll past the first two sections.
3. **Always recoverable**: Every setting can be reset to its default. Experiments are saved as snapshots so you can always go back.
4. **Show, don't tell**: Visualise where possible (scheduler curves, loss trends, sample images) rather than explaining with text.
5. **Guard rails, not walls**: Prevent obviously wrong values, warn about risky ones, but don't lock people out of experimentation.

---

## Page Structure

The training page uses the same TopShelf header as the tagging interface (project menu,
theme switcher, etc.) but no BottomShelf (no pagination). Training-specific content
like the progress badge integrates into the existing TopShelf pattern.

The route could be `/training/[project]` (pre-selected project) or `/training`
(pick dataset sources within the form). Both work — the project slug pre-populates
the dataset section but isn't required.

The page has two states:

### A) Configuration State (no active job)

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Projects    Project Name    [Job Status]     │  ← Minimal top bar
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Model & Output ─────────────────────────────── ▾ ┐  │
│  │  [Model selector]  [Backend auto-selected]        │  │
│  │  Output name: [________]  Output path: [________] │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Dataset ─────────────────────────────────────── ▾ ┐  │
│  │  Source: [my-character-project ▾]  [+ Add source] │  │
│  │                                                   │  │
│  │  📁 5_character  (45 images, ×5 repeats)   [___]  │  │
│  │  📁 3_background (20 images, ×3 repeats)   [___]  │  │
│  │  📁 (root)       (12 images, ×1 repeat)    [___]  │  │
│  │                                                   │  │
│  │  Total: 77 images, 345 effective                  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Training ────────────────────────────────────── ▾ ┐  │
│  │  Duration: [Epochs ▾] [20___]                     │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   │  │
│  │  345 images/epoch × 20 epochs = 6,900 steps       │  │
│  │  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   │  │
│  │  Learning rate: [1e-4___]                         │  │
│  │  Optimizer: [AdamW 8-bit ▾]                       │  │
│  │  Batch size: [1___]                               │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Network ─────────────────────────────────────── ▾ ┐  │
│  │  Type: [LoRA ▾]                                   │  │
│  │  Rank: [16___]    Alpha: [16___]                  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Advanced ────────────────────────────── collapsed ┐  │
│  │  ▸ Scheduler, warmup, gradient accumulation...    │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Saving & Samples ───────────────────── collapsed ┐  │
│  │  ▸ Save frequency, sample prompts, sample config  │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌───────────────────────────────────────────────────┐  │
│  │  [Save as snapshot ▾]  [Load preset ▾]            │  │
│  │                                                   │  │
│  │  ┌─ Pre-flight ────────────────────────────────┐  │  │
│  │  │  ✓ Dataset: 77 images with captions         │  │  │
│  │  │  ✓ Model: Will download (~12GB) on start    │  │  │
│  │  │  ⚠ VRAM: ~22GB estimated (you have 24GB)    │  │  │
│  │  │  ✓ Config: All values within expected range  │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │                                                   │  │
│  │              [ Start Training ]                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### B) Training State (job active)

```
┌─────────────────────────────────────────────────────────┐
│  ← Back to Projects    Project Name    ● Training...    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─ Progress ────────────────────────────────────────┐  │
│  │  Step 1,250 / 6,900              18% ██▓░░░░░░░   │  │
│  │  Epoch 4 / 20                    ETA: 45m 12s     │  │
│  │                                                   │  │
│  │  ┌─ Learning Rate ─────────────────────────────┐  │  │
│  │  │  1e-4 ┤━━━━━                                │  │  │
│  │  │       │     ━━━                 ─ ─ planned  │  │  │
│  │  │  5e-5 ┤        ━━━             ━━━ actual   │  │  │
│  │  │       │           ━━━━                      │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │  ┌─ Loss ──────────────────────────────────────┐  │  │
│  │  │  0.15 ┤ ╮                                   │  │  │
│  │  │       │  ╲                                  │  │  │
│  │  │  0.10 ┤   ╲___                             │  │  │
│  │  │       │       ╲___╱─╲                      │  │  │
│  │  │  0.08 ┤              ──────                │  │  │
│  │  │       ├────┬────┬────┬────┬────            │  │  │
│  │  │       0   250  500  750 1000 1250          │  │  │
│  │  └─────────────────────────────────────────────┘  │  │
│  │                                                   │  │
│  │  ↓ Loss is decreasing — training is learning      │  │
│  │  Current: 0.0823   Loss reduced by 42%            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Samples ─────────────────────────────────────────┐  │
│  │  Step 250       Step 500       Step 750   Step 1k │  │
│  │  ┌─────────┐   ┌─────────┐   ┌─────────┐  ┌────┐ │  │
│  │  │         │   │         │   │         │  │    │ │  │
│  │  │  img 1  │   │  img 2  │   │  img 3  │  │ 4  │ │  │
│  │  │         │   │         │   │         │  │    │ │  │
│  │  └─────────┘   └─────────┘   └─────────┘  └────┘ │  │
│  │  "a woman with red hair..."                       │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Log ──────────────────────────── collapsed ──────┐  │
│  │  ▸ Training output log (last 50 lines)            │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Settings used ───────────────── collapsed ──────┐  │
│  │  ▸ Read-only view of the config for this run      │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│              [ Cancel Training ]                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Section Details

### 1. Model & Output (always visible)

**Model selector**: Dropdown grouped by architecture. Selecting a model:

- Auto-selects the backend (ai-toolkit or Kohya) — user doesn't need to care
- Populates all defaults for every other field
- Shows a brief note: "Flux.1 Dev — Best for photorealistic styles and characters"

**Output name**: Auto-generated from project name + model, editable.
**Output path**: Defaults to a sensible location, editable.

### 2. Dataset (always visible)

**Project source picker**: Dropdown of all available projects. If navigated from
`/training/[project]`, that project is pre-selected. Users can add additional
project sources with "+ Add source" for multi-project datasets (V2).

For each selected project, auto-populated from the folder structure. We already
parse repeat folders (`5_sonic/`, `3_background/`), so we show:

- Each subfolder with image count and detected repeat count
- Root-level images as their own entry
- Editable repeat count per subfolder (number input)
- Total effective images across all sources (sum of images × repeats)

This section requires zero configuration for a well-structured project — just
pick the project and the rest is detected.

### 3. Training (always visible)

**Duration toggle**: Switch between "Set by epochs" and "Set by steps".

- When setting epochs: shows calculated step count
- When setting steps: shows calculated epoch count
- Formula shown inline: `77 images × 5 avg repeats × 20 epochs ÷ 1 batch = 6,900 steps`

**Learning rate**: Number input. Shows the model default as placeholder text.

**Optimizer**: Dropdown with grouped options:

- Recommended: AdamW 8-bit (good balance)
- Memory-efficient: Adafactor, Prodigy (auto-LR)
- Advanced: AdamW, Lion, DAdaptation
- Brief inline note for the selected optimizer (e.g., "Auto-adjusts learning rate" for Prodigy)

**Batch size**: Usually 1 for LoRA. Show VRAM warning if increased.

### 4. Network (expanded by default)

**Type**: LoRA (default), LoCoN, LoKr. Most users stay on LoRA.
**Rank**: Slider + number input, 1-128. Default 16.
**Alpha**: Slider + number input. Default = rank.

Inline guidance: "Higher rank = more expressive but more VRAM and overfitting risk"

### 5. Advanced (collapsed by default)

**Scheduler**: Dropdown with inline sparkline visualisation.

```
constant              ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁  Flat — simple and predictable
cosine                █▇▅▃▂▁▁▂▃▅▇█▇▅▃▁  Waves — good for longer training
cosine (no restarts)  █▇▆▅▄▃▂▂▁▁▁▁▁▁▁▁  Gentle decay — most popular default
linear                █▇▆▅▄▃▂▁▁▁▁▁▁▁▁▁  Steady decrease
constant + warmup     ▁▂▄████████████████  Ramp up then flat — good with Prodigy
```

The sparkline is a tiny inline SVG (about 60×16px) next to each option in the dropdown
and displayed next to the selected value. Shows the LR shape at a glance.

**Warmup steps**: Number input, with a percentage shortcut (e.g., "10%" = 10% of total steps).

**Gradient accumulation**: Number input. Effective batch size shown: "Effective batch: 4 (1 × 4 accumulation)".

**Mixed precision**: bf16 (default for modern GPUs) / fp16 dropdown.

**Resolution**: Multi-value for Flux (e.g., [512, 768, 1024]), single for SDXL (1024).
Show as tag-style chips that can be added/removed.

### 6. Saving & Samples (collapsed by default)

**Save frequency**: Every N epochs or N steps.
**Max checkpoints to keep**: Slider, 1-10.
**Sample prompts**: Textarea, one prompt per line. Optional.
**Sample frequency**: Every N steps. Only shown if prompts are provided.
**Sample dimensions**: Width × height, with aspect ratio presets.

---

## Charts Design

The charts are the centrepiece of the training monitor. Two stacked mini-charts
give a complete picture of training health.

### Top chart: Learning Rate Schedule

This chart shows what the optimiser is doing. Because the LR schedule is pure
maths (we know the scheduler type, total steps, warmup, and restarts), we can
draw the **full planned curve before training even starts** as a faint background line.

As training progresses, the **actual LR** is plotted on top as a solid line.
These should overlap almost exactly — the value of showing both is:

- Before training: "Here's what your scheduler will do." Helps users understand
  their choice visually without reading documentation.
- During training: Confirms the schedule is executing as expected.
- The x-axis is shared with the loss chart below for easy correlation.

```
LR ┤ Planned ─ ─ ─     Actual ━━━
   │
   │  ━─━─
   │      ━─━
   │          ─━─
   │              ─━─━
   │                   ━─ ─ ─ ─ ─ ─ ─    (training still running)
   ├────┬────┬────┬────┬────┬────┬────
   0   1k   2k   3k   4k   5k   6k  steps
```

This chart is small (about 60px tall). The LR axis uses scientific notation
(1e-4, 5e-5, etc.) with just two labels: start value and current value.

### Bottom chart: Training Loss

This is where users gauge if training is working.

**Primary line**: Smoothed loss (exponential moving average, window ~50 steps).
This removes noise and shows the actual trend.

**Secondary area** (subtle, semi-transparent): Raw per-step loss band, so users
can see the noise level without it overwhelming the smoothed trend.

**Annotations**:

- Checkpoint saves marked with small dots on the x-axis
- Sample generation points marked with small camera icons
- Epoch boundaries as subtle vertical lines

The visual correlation between the two charts is instructive:

- When LR drops (cosine valley), loss typically stabilises or improves
- When LR restarts (jumps back up), loss temporarily spikes then recovers
- If loss diverges while LR is steady, something else is wrong

Seeing both together teaches users what schedulers actually do, without needing
to read documentation. Over a few training runs, users build intuition.

### Trend indicator

Below the charts, a plain-English summary:

| Pattern             | Message                                                      | Colour |
| ------------------- | ------------------------------------------------------------ | ------ |
| Steadily decreasing | ↓ Loss is decreasing — training is learning                  | Green  |
| Flattening out      | → Loss has stabilised — training may be converging           | Amber  |
| Increasing          | ↑ Loss is increasing — possible overfitting                  | Red    |
| Noisy but flat      | ↔ Loss is noisy but stable — consider lowering learning rate | Amber  |
| Very low and flat   | ✓ Loss is very low and stable — training looks complete      | Green  |

This is the "translation layer" that makes loss values meaningful to people who
don't know what 0.082 means. They don't need to know the number — they need to
know if training is going well.

### Scale and context

- **Y-axis (loss)**: Start from minimum observed loss, not zero — small changes need to be visible
- **Y-axis (LR)**: Scientific notation, two labels only (start + current)
- **X-axis**: Shared between both charts, labelled in steps with epoch markers
- Show starting loss, current loss, and percentage improvement: "Loss reduced by 42%"
- On hover/tap: crosshair shows exact values at that step for both charts

---

## Reset to Defaults

Three tiers:

### Per-field reset

When a field's value differs from the model default, a subtle reset icon (↩) appears
on hover to the right of the field. Single click resets that one field. No confirmation
needed — it's just one field.

### Per-section reset

Each section header has a "Reset section" text button (only visible when any field in
the section has been modified). Resets all fields in that section to model defaults.

### Full reset

"Reset all to defaults" button at the bottom of the form. Shows a brief confirmation
since this affects everything.

**Key principle**: Defaults are model-specific. If you switch from Flux to SDXL, the
defaults change. Resetting always goes back to the _current model's_ defaults.

---

## Contextual Help

**"What's this?" toggle**: A small `?` icon in each section header. When toggled on,
every field in that section gets a one-line plain-English description underneath it.

Examples:

- **LoRA Rank**: "Higher values learn more detail but use more VRAM and risk overfitting. 16 is a reliable starting point."
- **Learning Rate**: "How aggressively the model learns. Too high = unstable, too low = slow. Most models work well at 1e-4."
- **Cosine Scheduler**: "Gradually reduces the learning rate following a cosine curve, helping the model fine-tune details in later steps."

The toggle state persists in preferences. Defaults to ON for first-time users,
OFF once they've used the training page a few times (or they can toggle it manually).

---

## Presets

### Built-in presets (per model)

Each model has a "Standard" preset that's the default. We may add more:

- "Standard" — balanced defaults
- "Quick test" — low steps, small rank, fast iteration
- "High quality" — more steps, higher rank, lower LR

### User presets (save/load)

- "Save as preset" button opens a dialog: name + optional description
- Presets are stored in project config under `training.presets[]`
- "Load preset" dropdown shows built-in + user presets
- User presets can be deleted

### Settings snapshots (experiment tracking)

Separate from presets — snapshots are tied to training runs:

- When you start training, the current settings are auto-saved as a snapshot
- Snapshot includes: timestamp, all settings, and (after training) the loss curve + result
- "History" panel shows previous snapshots for this project
- Click a snapshot to view its settings (read-only) or "Load these settings" to copy them back

### Import from safetensors (V2)

- "Import from file" button reads safetensors metadata
- Populates what it can (rank, alpha, model, optimizer are commonly stored)
- Shows what was imported and what couldn't be read

---

## Training Projects Data Model

Training projects are separate from tagging projects. A tagging project is a folder
of images; a training project is a named configuration for producing a LoRA.

### Storage

Training project configs live in `training-projects/` in the app root (alongside
`public/tagging-projects/` for tagging project metadata). Each training project
is a JSON file: `training-projects/[slug].json`.

### URL structure

```
/training                              → Training project list / dashboard
/training/[slug]                       → Latest config for this training project
/training/[slug]/[version]             → Specific snapshot/version (V2)
```

### Schema

```json
{
  "name": "flux-character",
  "slug": "flux-character",
  "model": "flux-dev",
  "provider": "ai-toolkit",
  "datasets": [
    {
      "project": "my-character",
      "repeats": { "5_close": 5, "3_bg": 3, "(root)": 1 }
    }
  ],
  "hyperparameters": { "lr": 1e-4, "epochs": 20, "networkDim": 16, "..." : "..." },
  "samplePrompts": ["a woman with red hair, ..."],
  "outputName": "flux-character",
  "outputPath": "C:\\training-folder\\outputs",
  "versions": [
    {
      "id": "v1",
      "name": "Initial attempt",
      "timestamp": "2026-03-30T12:00:00Z",
      "settings": { "...full config snapshot..." },
      "result": {
        "finalLoss": 0.082,
        "steps": 6900,
        "duration": "1h 23m",
        "outputFile": "flux-character-v1.safetensors"
      }
    }
  ]
}
```

### Relationship to tagging projects

```
Tagging Projects (image folders)       Training Projects (configurations)
public/tagging-projects/               training-projects/
├── my-character.json                  ├── flux-character.json
├── bg-plates.json                     ├── sdxl-style-v2.json
└── ref-photos.json                    └── wan-motion-test.json

A training project references tagging projects by name in its datasets array.
Multiple training projects can reference the same tagging project.
A single training project can pull from multiple tagging projects.
```

---

## Pre-flight Validation

Before starting training, run automated checks and show results:

| Check                | Pass                  | Warn                                  | Fail                    |
| -------------------- | --------------------- | ------------------------------------- | ----------------------- |
| Dataset has images   | ✓ 77 images found     | ⚠ Only 5 images (risk of overfitting) | ✗ No images found       |
| Images have captions | ✓ All captioned       | ⚠ 3 images missing captions           | ✗ No captions found     |
| Model available      | ✓ Cached locally      | ⚠ Will download (~12GB)               | ✗ Model not found       |
| VRAM estimate        | ✓ ~16GB (fits easily) | ⚠ ~22GB (tight fit on 24GB)           | ✗ ~32GB (likely OOM)    |
| Config sanity        | ✓ All values normal   | ⚠ LR seems high (0.01)                | ✗ Steps is 0            |
| Backend available    | ✓ ai-toolkit ready    | —                                     | ✗ Backend not installed |

The "Start Training" button is always clickable (we don't block users), but warnings
are shown prominently. Failures show a clear message about what to fix.

---

## Queue System (V2)

### Floating status indicator

A small persistent element (like a mini-player) visible on all views when training
is active or queued:

```
┌──────────────────────────────────────────┐
│  ● Training: my-lora  Step 1,250/6,900   │
│    ██████▓░░░░░░░░░  18%  ETA: 45m       │
└──────────────────────────────────────────┘
```

Click to open the full queue modal.

### Queue modal

- Current job: full progress (loss chart, samples, cancel button)
- Queued jobs: list with project name, model, step count, cancel/reorder
- Drag to reorder queued items
- "Cancel all" button
- Completed jobs (last few): status, final loss, link to outputs

---

## Component Breakdown

```
src/app/components/training/
├── training-config-form/
│   ├── training-config-form.tsx        # Form layout, section management
│   └── use-training-config-form.ts     # Form state, defaults, validation
├── sections/
│   ├── model-section.tsx               # Model selector + output config
│   ├── dataset-section.tsx             # Auto-detected folders + repeat overrides
│   ├── training-section.tsx            # Duration, LR, optimizer, batch
│   ├── network-section.tsx             # LoRA type, rank, alpha
│   ├── advanced-section.tsx            # Scheduler, warmup, grad accum, precision
│   └── saving-section.tsx              # Save frequency, sample prompts
├── collapsible-section.tsx             # Reusable collapsible container
├── scheduler-sparkline.tsx             # Inline SVG scheduler visualisation
├── training-charts/
│   ├── training-charts.tsx            # Stacked LR + Loss chart container
│   ├── lr-chart.tsx                   # Learning rate schedule chart (planned vs actual)
│   ├── loss-chart.tsx                 # Live training loss chart (smoothed + raw)
│   └── trend-indicator.tsx            # Plain-English trend summary
├── sample-gallery.tsx                  # Training sample image viewer
├── pre-flight-panel.tsx                # Validation checks before start
├── preset-manager.tsx                  # Save/load presets
├── snapshot-history.tsx                # Experiment version history
├── training-status-badge.tsx           # Persistent mini-status for all views
├── training-progress-panel.tsx         # Full progress view during training
└── training-log-viewer.tsx             # Scrollable stdout log
```
