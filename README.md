# SignFlow

**Draw naturally. Animate beautifully. Export anywhere.**

A free, open-source, browser-only handwriting editor that turns a drawn signature into a smooth (and soon animated) SVG. No backend, no accounts, no analytics.

Status: **Phase 1 (drawing engine)** is done, with a playground that can export a transparent **static SVG**, an **animated SVG** (strokes drawn one after another, CSS only, no JavaScript) and a **PNG**. The full editor UI is next. `examples/` has sample output. See [docs/architecture.md](docs/architecture.md).

```bash
npm install
npm test          # engine unit tests
npm run dev       # playground at http://localhost:5173
npm run typecheck
```

## Editor

A full-screen dot-grid canvas with floating controls: top bar (theme, export), bottom toolbar (undo, redo, clear, grid, pen settings), a pen panel (ink, width, smoothing, stroke shape) and an export drawer (animated / static preview, timing, SVG and PNG downloads).

| Key | Action |
|---|---|
| `Ctrl/⌘ Z` | Undo |
| `Ctrl/⌘ Shift Z` or `Ctrl Y` | Redo |
| `G` | Toggle grid |
| `P` | Toggle pen panel |
| `E` | Open export |
| `Esc` | Close export |

The top bar links to the repository via `REPO_URL` in `apps/web/src/stores/editor.svelte.ts` (set it to an empty string to hide the link).

MIT licensed.
