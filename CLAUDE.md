# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FastLED Video Mapper (www.ledmapper.com) — a web-based tool suite for mapping video content to physical LED arrays (WS2812/APA102). Built with Vite (MPA), ES modules, and hosted on GitHub Pages.

## Running Locally

```bash
# One-time setup
npm install

# Start dev server (port 8080, opens hub page)
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Lint
npm run lint

# Run E2E tests (starts dev server automatically)
npm test
```

## Architecture

**Vite MPA (Multi-Page App)** using vanilla JavaScript, p5.js (instance mode), Three.js, and SweetAlert2. All dependencies managed via npm. ES modules throughout.

**Shared nav bar:** Each tool page includes a shared navigation header (`src/nav.js`). Regular `<a>` links navigate between tools. No iframes.

### File Structure

```
src/              # Source code (Vite root)
  common.js       # Shared utility functions (ES module)
  nav.js          # Shared navigation bar component
  styles/         # Shared CSS (global.css, nav.css)
  hub/            # Landing page with tool cards
  demo/           # Demo tool
  screenmap/      # Screenmap Maker tool
  moviemaker/     # Mapped Video Maker tool (Three.js + GLSL)
  movieplayer/    # Movie Player tool
  shapeviewer/    # Shape Viewer tool
public/           # Static assets (served as-is by Vite)
  demo/           # Sample data files (.rgb, .json)
  examples/       # Example projects
tests/
  e2e/            # Playwright E2E tests
  fixtures/       # Test data files
  helpers/        # Test utilities (webcam mock, etc.)
```

### Tools (each in `src/<tool>/`)

| Directory | Tool | Core Tech | Purpose |
|-----------|------|-----------|---------|
| `demo/` | Demo | p5.js | Visualize mapped video playback with sample data |
| `screenmap/` | Screenmap Maker | p5.js | Interactively map physical LED positions, export JSON |
| `moviemaker/` | Mapped Video Maker | Three.js + GLSL | Load video files or webcam, GPU blur, record mapped LED output |
| `movieplayer/` | Movie Player | p5.js | Play back pre-recorded .rgb LED video files |
| `shapeviewer/` | Shape Viewer | p5.js | Visualize screenmap.json as a shape |

### Shared Code

`src/common.js` — ES module with utility functions imported by each tool:
- `parse_shape_data_json()` / `parse_shape_data_csv()` — parse screenmap formats
- `transform_to_center_of_canvas()` — center and scale points to canvas
- `download_blob_as_file()` / `download_binary_as_file()` / `download_text_as_file()` — file downloads
- `estimate_led_size()` — calculate LED diameter from point spacing

### Data Formats

**Screenmap JSON** (the primary interchange format between tools):
```json
{
  "map": {
    "strip1": {
      "x": [0, 1, 2, ...],
      "y": [0, 0, 0, ...],
      "diameter": 0.25
    }
  }
}
```

**Video files** (`.rgb`): Raw binary — sequential RGB triplets (3 bytes per LED per frame). Frame count = `total_bytes / (led_count * 3)`.

### Key Patterns

- p5.js tools use **instance mode**: `new p5((p) => { p.setup = () => {...}; p.draw = () => {...}; })`
- All JS uses ES module `import`/`export` — no CDN `<script>` tags
- `moviemaker/` uses Three.js with GLSL fragment shaders for GPU-accelerated blur and readback for recording
- UI uses dark theme (background: #121212, accent: #2980b9) with SweetAlert2 for dialogs
- Each tool's `index.html` imports `../styles/global.css`, `../styles/nav.css`, and its own CSS
