# Attribic - Image tagger and LoRA training UI

A local, browser-based workbench for organising and tagging image (and video) collections — primarily aimed at preparing training datasets for image generation models, but useful for any bulk tagging workflow.

Everything runs on your own machine. No cloud, no accounts, no uploads. Your images stay where they are, and tags are written as plain `.txt` files next to them.

## What it does

Point it at a folder of folders containing images you want to tag. Each subfolder becomes a project. Open a project and you get a paginated gallery of its images, tools for editing tags on them one-by-one or in bulk, filters for slicing the set, and an auto-tagger that can populate tags for you.

### Projects

- **Folder-based.** A project is just a directory of images. Put multiple project folders inside your projects folder and they'll all show up on the home page.
- **Per-project metadata.** Custom project titles, accent colours, thumbnails, featured/hidden flags (stored in `public/tagging-projects/[project-name].json`. See [public/tagging-projects/README.md](public/tagging-projects/README.md) for the full schema.)

### Tagging view

- **Three caption modes** you can switch between for any given project:
  - **Tag mode** — comma-separated imageboard-style tags, with drag-and-drop reordering.
  - **Caption mode** — natural-language prose for models that prefer sentences.
  - **Hybrid mode** — comma-separated imageboard-style tags and natural language prose, together for models that mix the two styles
- **Bulk editing** — select multiple images (shift-click for ranges, shift-hover to preview the range before committing), then add, remove, or rewrite tags across the whole selection. Copy/paste tags between assets.
- **Rich filtering** — filter by tag (match-any / match-all / exclude), dimensions, file type, subfolder, tagged/untagged state, and unsaved-changes state.
- **Video assets** — (new) `.mp4` files are treated as first-class assets alongside images. A poster frame is generated for the gallery thumbnail and for ONNX auto-tagging, for VLM tagging with a capable model, the video itself is passed for temporal descriptions.
- **Crop preview** — optional overlay showing how each asset would be cropped into Kohya-style training buckets (useful if you're training SDXL or its variants), so you can eyeball framing before training.
- **Light and dark themes supported.** Yep.

### Auto-tagger

Two independent engines, both driven from the same in-app UI with streaming batch progress and a shared download/model manager.

1. **ONNX imageboard tagger (WD14-style)** — runs entirely in-process via `onnxruntime-node`. No Python required. Produces comma-separated tags with configurable confidence thresholds for general/character/rating groups.
2. **VLM captioner** — runs in a Python sidecar (spawned on demand) for natural-language captions. Two optional backends:
   - **CPU** — GGUF models via `llama-cpp-python`.
   - **GPU** — safetensors models via `PyTorch` + HuggingFace `transformers` (Windows CUDA 12.8).

   Supports per-project trigger phrases that can be prepended, appended, or woven into generated captions (when using natural language auto-tagging), with the phrases highlighted in the UI. VLMs that support video (e.g. Qwen-VL) receive raw video paths and sample frames themselves; other models (e.g. ONNX) fall back to extracted poster frames.

Batch runs stream progress over a streaming setup, can be cancelled mid-run, and write directly to the `.txt` files.

### File layout on disk

```
<projectsFolder>/
  my-project/
    cat.jpg
    cat.txt           ← tags for cat.jpg
    clip.mp4
    clip.txt          ← tags or caption for clip.mp4
    _project.json     ← optional, marks project private
```

- Supported images: `.jpg`, `.jpeg`, `.png`, `.webp`
- Supported video: `.mp4`
- Tags: comma-separated, one line, in a `.txt` file with the same stem as the asset.

## Installing

The app is a Next.js project. The auto-tagger ONNX engine is pure JS and works out of the box. The Python sidecar (for VLM captioning) is optional and only needed if you want natural-language captions or training.

### 1. Prerequisites

- **Node.js 24+** and **[pnpm](https://pnpm.io/)** (the `packageManager` field pins a specific pnpm version — corepack will pick it up automatically).
- **[ffmpeg](https://ffmpeg.org/)** on your `PATH`, if you want video support. Windows: `winget install Gyan.FFmpeg`.
- **[uv](https://docs.astral.sh/uv/)**, only if you want VLM captioning. The sidecar uses it to manage its own Python 3.12 venv on first run.

### 2. Clone and install JS dependencies

```bash
pnpm install
```

### 3. (Optional) Python sidecar for VLM (natural language) captioning

Pick the runtime(s) you want:

```bash
cd training-sidecar
uv sync --extra vlm     # CPU (GGUF via llama-cpp-python)
uv sync --extra gpu     # GPU (PyTorch, Windows CUDA 12.8)
uv sync --extra vlm --extra gpu   # both
```

Re-running `uv sync` with only one extra will uninstall the other, so be deliberate. The app will start the Python sidecar on demand.

### 4. Run it

```bash
pnpm dev
```

Open <http://localhost:3000>, pick a project, and start tagging.

## Other commands

- `pnpm build` — production build
- `pnpm lint` — ESLint
- `pnpm format` — Prettier + `eslint --fix`
- `pnpm knip` — find unused code and dependencies
