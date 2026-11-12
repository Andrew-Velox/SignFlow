<div align="center">

<img src="apps/web/public/apple-touch-icon.png" alt="SignFlow logo" width="96" height="96" />

# SignFlow

**Draw naturally. Animate beautifully. Export anywhere.**

A free, open-source, browser-only handwriting editor that turns a drawn signature into a smooth, animated SVG.<br />
No backend, no accounts, no analytics.

[![License: MIT](https://img.shields.io/badge/license-MIT-171717.svg)](LICENSE)
[![Svelte 5](https://img.shields.io/badge/Svelte-5-ff3e00.svg?logo=svelte&logoColor=white)](https://svelte.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg?logo=vite&logoColor=white)](https://vite.dev)
[![Runs locally](https://img.shields.io/badge/privacy-100%25%20local-2ea44f.svg)](#)

[Architecture](docs/architecture.md) · [Examples](examples/)

</div>

---

Exports a transparent **static SVG**, an **animated SVG** (strokes drawn one after another, CSS only, no JavaScript) and a **PNG**, with optional rotation.

```bash
npm install
npm test          # engine unit tests
npm run dev       # playground at http://localhost:5173
npm run typecheck
```

## Editor

A full-screen dot-grid canvas with floating controls: top bar (theme, export), bottom toolbar (undo, redo, clear, grid, pen settings), a pen panel (ink, width, smoothing, stroke shape) and an export drawer (animated / static preview, rotation, crop, timing, SVG and PNG downloads).

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
