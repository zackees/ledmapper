---
name: produce-mapped-video
description: One-command production of a mapped-LED MP4 from a source video — packages the input, drives the unattended producer, names the output, and optionally builds the source-vs-mapped comparison splice. Use when asked to map/render/produce a video onto an LED panel, apply a screenmap to a clip, or make an A/B comparison of a mapped render.
---

# Produce a mapped-LED video

`scripts/produce_mapped_video.py` collapses the whole production workflow into
one command. Use it instead of assembling ZIPs, job URLs, and ffmpeg calls by
hand, and instead of driving the interactive recorder (which is slower, not
repeatable, and hard to compare frame-to-frame).

```bash
python scripts/produce_mapped_video.py 'E:\video\short\fluid_swirls.mp4'
```

That single command starts or reuses the dev server, packages the MP4 plus the
map as `screenmap.json`, serves the ZIP on a loopback port, runs
`scripts/produce_video_mapping.py --allow-private-network`, extracts the MP4 to
`E:\video\short_out` under a descriptive versioned name, builds the
source-left / mapped-right splice, and opens the result.

## Defaults

| Setting | Default | Override |
|---|---|---|
| Map | `public/screenmaps/64x64_quad_serpentine.json` | `--map <path>` |
| Panel rotation | `-45` (diamond panel, content upright) | `--panel-rotation 0` |
| Layout | `mapped-led` (1024x1024, panel fills frame) | `--video-mode side-by-side` |
| Cadence | source timing preserved | `--output-fps 30\|60` |
| Auto bloom | on | `--no-auto-bloom` |
| Bloom strategy | `chroma-shoulder` | `--strategy <name>` (repeatable) |
| Splice | built | `--no-stitch` |
| Output | `E:\video\short_out` | `--output-dir <path>` |
| Opens result | yes | `--no-open` |

Pass `--version v3-<what-changed>` on every experiment so the review history in
`short_out` stays inspectable.

## Choosing flags

- **"map this video to a 64x64 panel"** — bare command, defaults are right.
- **"non-rotated / square panel"** — add `--panel-rotation 0`.
- **"just the mapped LED video"** — bare command plus `--no-stitch`.
- **"show me it next to the original"** — the default splice already does this.
  `--video-mode side-by-side` is different: it bakes the two panes into the
  producer's own render rather than splicing two finished MP4s.
- **"16x16 grid"** — `--map public/screenmaps/16x16_serpentine.json`.
- **A/B of two renders** — run twice with different `--version` tags and
  `--no-stitch`, then splice the two mapped MP4s (baseline left, candidate
  right) per the HDR-bloom protocol in `CLAUDE.md`.

## Comparing HDR bloom strategies

The composite algorithm is selectable. Strategies live in
`src/moviemaker/hdr-bloom-strategies.ts` and are never deleted, so any past
experiment can be re-rendered by name. The CLI reads the registry directly, so
`--help` always lists what actually exists.

```bash
# Baseline vs two candidates, as a labelled 2x2 grid with the source top-left.
python scripts/produce_mapped_video.py 'E:\video\short\fluid_swirls.mp4' \
  --strategy chroma-shoulder --strategy white-core-chroma \
  --strategy wide-surround-chroma --version v2-wide
```

Two or more `--strategy` values imply `--compare`; the grid holds the source
plus at most three strategies (2 tiles stack horizontally, 3–4 form the 2x2).
Every tile is labelled and letterboxed to a common cell, so a 9:16 source and a
1:1 panel stay directly comparable.

| Strategy | What it does |
|---|---|
| `chroma-shoulder` | Shipped default; the baseline every candidate is judged against. |
| `linear-hdr` | Resurrected 2c51e78 — first fully-linear composite, pure bracket selection. |
| `chroma-capped` | Resurrected 68d2550 — mid-bracket chroma, one shared energy ceiling. |
| `white-core-chroma` | Gates white-merge suppression by raw saturation. |
| `sliding-window` | Continuous exposure window by per-pixel headroom, no discrete selection. |
| `wide-surround-chroma` | Real spatial separation between brackets; blown highlights take hue from the annulus around them. |

**Judge with measurement, not just eyes.** Mean saturation over the panel and
over the blown core, plus the fraction of bright pixels that are near-achromatic,
separate a genuine chroma win from an image that is merely dimmer. A candidate
that raises saturation while *lowering* brightness has usually just underexposed.

## After it runs

The script prints the mapped MP4 path and, when stitching, the splice path.
**Always open the output and check representative frames** — frame 0, bright
highlights, midtones, and deep shadows — before claiming a visual result.
`CLAUDE.md` documents the failure modes to watch for (white-merged highlights,
lifted blacks, aliasing bands on dense grids, an unsettled frame 0).

## Requirements and gotchas

- Stitching needs ffmpeg. The script prefers the `static-ffmpeg` Python package,
  falls back to `ffmpeg` on PATH, and fails fast *before* rendering if neither
  is available.
- Rendering H.264 needs Google Chrome installed; Playwright's bundled Chromium
  can report `MP4_ENCODING_UNSUPPORTED`.
- The dev server runs on a fixed port (`--dev-port`, default 5199) and is left
  running so the next invocation reuses it. This is deliberate:
  `dev-server.mjs` detects an existing server only by probing the port, so the
  default OS-assigned port would leak one Vite process per run.
- The producer refuses to overwrite an existing package, so the script renders
  into a temp directory and copies both the MP4 and the ZIP into the output
  directory itself. Temp state is always cleaned up.

`docs/production-cli.md` documents the underlying job-URL parameters for cases
this wrapper does not cover.
