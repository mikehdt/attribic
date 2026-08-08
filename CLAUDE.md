# Project Constraints

Multi-project only — no single-project/default mode. Project context is derived from the URL slug, not sessionStorage. The `[project]` segment is the folder name within the configured `projectsFolder`.

# Development Guidelines

## File Structure and Naming

- Lower kebab-case filenames for all TypeScript/TSX files (`file-name.ts`)
- Preference for named exports over default exports
- Only export values consumed elsewhere
- Path alias `@/app/...` for clean imports, maximum two `../../` levels

## Component Folder Pattern (preferred)

When a component has enough logic to warrant splitting, use a colocated folder:

```
component-name/
  component-name.tsx     ← presentational component (JSX)
  use-component-name.ts  ← hook with data, state, and logic
```

- **No per-component `index.ts` barrels** — import directly from the source file (e.g. `./component-name/component-name`). Barrels add indirection that slows navigation when tracing imports
- **Parent-level `index.ts` barrels are fine** for feature boundaries (e.g. a `components/index.ts` that acts as the public API for a feature area)
- **Component-specific hooks** live alongside their component in its folder
- **Shared hooks** (used by multiple siblings) live in a `hooks/` directory at the parent level
- This pattern ensures moving a folder moves all related code with it

## Code Style

- Australian English for UI text, US English for code (e.g., `colour` vs `color`)
- Prefer `requestAnimationFrame` over `setTimeout` for UI timing
- Performance optimisation with `React.memo`, `useSelector`, `useMemo`, `useCallback`
- For Lucide icons, use the `[Name]Icon` import, with the Icon suffix

## Data Structure

- Images have associated `.txt` files with comma-separated tags
- Supports .jpg, .jpeg, .png, .webp formats
- File pattern: `image.jpg` + `image.txt` in same directory
- UI state in memory only, not persisted between sessions
- Local app only; No over-the-network

## Documentation

- README.md files for complex components with sub-folders
- Minimal inline comments unless code is complex/unclear
- No need to document every prop

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
