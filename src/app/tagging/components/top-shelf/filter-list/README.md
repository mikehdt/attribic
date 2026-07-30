# Filter List

Popup panel for filtering assets by tag, size/bucket, and file attributes.
Opened from the toolbar via `FilterListButton`, which renders `FilterPanel`
inside a `Popup` wrapped in `FilterProvider`.

## Structure

```
filter-list-button.tsx       # Toolbar toggle button + popup wiring
filter-context.tsx           # FilterProvider / useFilterContext
filter-panel.tsx             # Panel layout: view selector, controls, active view
list-view-selector.tsx       # Segmented control: Tags / Sizes / File
select-sizes-sub-view.tsx    # Size sub-view switcher: Images / Buckets
filter-controls.tsx          # Sort type/direction buttons + Clear button
filter-search-input.tsx      # Search row (input + clear) for tags/sizes/buckets
dimension-visualizer.tsx     # Shape box + × normalisation, shared sizes/buckets
comparators.ts               # Active / count / name orderings used by every view
hooks/                       # Shared across views: list length + scroll effects
use-keyboard-navigation.ts   # Arrow/Enter/Escape handling for the lists
use-range-toggle.ts          # Shift-click range selection shared by all views
view-tags/                   # Tag view (list + hook)
view-sizes/                  # Size view, Images sub-view (exact dimensions)
view-buckets/                # Size view, Buckets sub-view
view-file/                   # File view: name searches, subfolders, extensions
types.ts                     # Sort types, view types, sort cycles/labels
```

## Views

- **Tags** — filter by tag; hidden in caption mode.
- **Sizes** — two sub-views: **Images** (exact dimensions, sortable by count/
  active/size/ratio/megapixels) and **Buckets** (bucket dimensions).
- **File** — three sections in one scrolling list: filename search patterns
  (add/remove), subfolders, and file extensions.

## filter-context responsibilities

- Active view, size sub-view, and per-view (and per-sub-view) sort settings —
  persisted across popup open/close cycles via module-level variables.
- Transient search term, highlighted index, and list length.
- Shift-held tracking and the range-selection anchor for `useRangeToggle`.
- Keyboard navigation plumbing (delegates to `useKeyboardNavigation`).

Filter selections themselves live in the Redux `filters` slice; the views
dispatch toggle/clear actions and read counts from store selectors.

## Keyboard navigation

Focus stays in the search input. Arrow keys move the highlight, Enter toggles
the highlighted item (Shift+Enter extends a range), and Escape is two-stage:
first clears the highlight, then closes the panel.
