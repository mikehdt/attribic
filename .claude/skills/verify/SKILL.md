---
name: verify
description: Build/launch/drive recipe for verifying img-tagger changes at the browser surface.
---

# Verifying img-tagger changes

## Launch

- A dev server is often already running on port 3000 (the user's own `pnpm dev`) — check before starting one; Next.js refuses a second instance for the same dir. Turbopack HMR means code edits are live on fresh page loads.
- App config lives in `config.json` at the repo root; `projectsFolder` points at real user data (`F:\Training`).

## Safe test data

Create a throwaway project folder inside `projectsFolder` (e.g. `zz-verify`):
tiny 1x1 PNGs + same-named `.txt` files with comma-separated tags. Navigate to
`/tagging/<folder>/1`. Tag edits/reorders are Redux-only until the user clicks
Save, so driving the UI doesn't touch files. Delete the folder afterwards.

## Drive (browser)

No Playwright browsers installed; use `playwright-core` (scratchpad npm project)
with `chromium.launch({ channel: 'msedge', headless: true })` — system Edge, no
download.

Gotchas:
- Tag chips: selector `[role="button"].rounded-2xl`; tag name is the 2nd `<span>`.
- Tag DnD only mounts on hover — move the mouse over the tag list and wait ~300ms before dragging.
- PointerSensor has an 8px activation distance — move >8px after `mouse.down()` before expecting drag state.
- Use `steps:` on `mouse.move` and pause ~300ms before mid-drag screenshots so reflow/FLIP settles.
