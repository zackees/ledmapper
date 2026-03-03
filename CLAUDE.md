# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FastLED Video Mapper (www.ledmapper.com) — a web-based tool suite for mapping video content to physical LED arrays (WS2812/APA102). Static site hosted on GitHub Pages, no build system or package manager.

## Running Locally

```bash
# One-time setup
npm install -g http-server

# Start dev server
./run
# Or directly: http-server -p 8080 -o
```

## Architecture

**Static web app** using vanilla JavaScript, p5.js (v1.4.0), and Three.js (r128). No framework, no bundler, no npm packages.

**Hub + iframe pattern:** `index.html` is the main shell with sidebar navigation. Each tool loads in an iframe from its own subdirectory. Tools are independent and can also run standalone.

### Tools (each in its own directory)

| Directory | Tool | Core Tech | Purpose |
|-----------|------|-----------|---------|
| `demo/` | Demo | p5.js | Visualize mapped video playback with sample data |
| `screenmap/` | Screenmap Maker | p5.js | Interactively map physical LED positions, export JSON |
| `moviemaker/` | Mapped Video Maker | p5.js + Web Worker | Capture video and map to LED array with blur processing |
| `moviemaker2/` | Movie Player 2 | Three.js + GLSL | WebGL-based video player with Gaussian blur shader |
| `movieplayer/` | Mapped Video Player | p5.js | Play back pre-recorded .rgb LED video files |
| `shapeviewer/` | Shape Viewer | p5.js | Visualize screenmap.json as a shape |

### Shared Code

`common.js` — utility functions used across tools via `<script>` tag:
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

- Each tool's `sketch.js` defines p5.js `setup()` and `draw()` functions
- Heavy computation (blur) runs in a Web Worker (`moviemaker/blurWorker.js`)
- `moviemaker2/` uses Three.js with GLSL fragment shaders for GPU-accelerated blur
- UI uses dark theme (background: #1a1a1a, accent: #2980b9) with SweetAlert2 for dialogs
