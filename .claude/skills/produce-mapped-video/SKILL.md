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
uv run python scripts/produce_mapped_video.py 'E:\video\short\fluid_swirls.mp4'
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
| Bloom strategy | `acrylic-pane` | `--strategy <name>` (repeatable) |
| Frequency bias | temporal `auto` for `acrylic-pane` | `--bloom-frequency-mode low\|high` or `--bloom-frequency-blend 0..1` |
| Final review layout | off | `--final-artifact` (source 1/3, mapped 2/3) |
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
- **"original in the left third, mapped output in the remaining two-thirds"** —
  add `--final-artifact --no-stitch`. It emits the plain 1024×1024 mapped MP4
  plus a 1536×1024 `-dual.mp4`: the source is aspect-fitted/letterboxed into
  512×1024 and the mapped render fills the remaining 1024×1024. Do not combine
  this request with `--crop-source`, which emits separate 50/50 crop artifacts.
- **"16x16 grid"** — `--map public/screenmaps/16x16_serpentine.json`.
- **A/B of two renders** — run twice with different `--version` tags and
  `--no-stitch`, then splice the two mapped MP4s (baseline left, candidate
  right) per the HDR-bloom protocol in `CLAUDE.md`.
- **Frequency-controller A/B** — leave the candidate at the default `auto` and
  pin the baseline/diagnostic renders with `--bloom-frequency-mode low|high`
  or `--bloom-frequency-blend 0..1`. These pins are evaluator controls, not
  normal production defaults. Mips 3–4 remain zero at every curve position.

For a full final-artifact regeneration of `E:\video\short`, run the wrapper once
per `.mp4` with `--video-mode mapped-led --panel-rotation 0 --strategy
acrylic-pane --version batch --final-artifact --no-stitch --no-open`. The batch
must leave `E:\video\short` untouched. For the current 24-source inventory,
verify exactly 24 mapped MP4s and 24 `-dual.mp4` files in `short_out`, no ZIPs or
crop artifacts, 1536×1024 dual geometry, matching duration/FPS, and bt709/tv
tags.

## Comparing HDR bloom strategies

The composite algorithm is selectable. Strategies live in
`src/moviemaker/hdr-bloom-strategies.ts` and are never deleted, so any past
experiment can be re-rendered by name. The CLI reads the registry directly, so
`--help` always lists what actually exists.

```bash
# Baseline vs two candidates, as a labelled 2x2 grid with the source top-left.
uv run python scripts/produce_mapped_video.py 'E:\video\short\fluid_swirls.mp4' \
  --strategy chroma-shoulder --strategy white-core-chroma \
  --strategy wide-surround-chroma --version v2-wide
```

Two or more `--strategy` values imply `--compare`; the grid holds the source
plus at most three strategies (2 tiles stack horizontally, 3–4 form the 2x2).
Every tile is labelled and letterboxed to a common cell, so a 9:16 source and a
1:1 panel stay directly comparable.

For adaptive bloom, score the aligned source crop, fixed-mip baseline, and
candidate with `uv run python scripts/frequency_adaptive_bloom_gate.py ...`.
Temporal validation requires four aligned artifacts:
`frequency_temporal_bloom_gate.py SOURCE-CROP PINNED-LOW PINNED-HIGH ADAPTIVE`.
It derives the observed encoded blend from the endpoint renders; do not replace
those inputs with a source-only controller reconstruction.
For globally dark coherent footage, additionally run
`uv run python scripts/low_light_splat_gate.py SOURCE-CROP BASELINE CANDIDATE
-t .5 -t 1.5 -t 2.5 -t 3.5 -t 4.5 -t 5.5 -t 6.5 -t 7.5`. This protects the
AQPoUmw axial/diagonal overlap floor. Pair it with the AQNFgVV t=14
`shadow_structure_gate.py` ceiling and the AQP high-frequency gate: lowering
the dark-scene overlap threshold must not reopen bright-scene hair fill or
cross-hue contamination. The filtered global-light signal may shape this
overlap threshold only; it must not modulate exposure, capture strength, LED
diameter, or reopen mips 3-4.
Use `--regime high` for fine/chromatically discontinuous samples and `--regime
low` for coherent faces/surfaces. Do not combine the strata into a clip mean.
For dark colored detail, additionally run
`uv run python scripts/shadow_structure_gate.py SOURCE-CROP CANDIDATE
--reference MINIMAL -t 14 --roi 0 0 0.58 0.92`. This gate detects bloom-filled
inter-LED gaps even when the cores retain correct ordering. Do not loosen the
shadow ceiling to satisfy the coherent-fill floor; both must pass.

For spatial low/mid bloom changes, AQNFgVV at 9 seconds is a distinct ROI
ratchet from whole-face fill. Run:

```powershell
uv run python scripts/local_midtone_bias_gate.py SOURCE-CROP.mp4 `
  PREVIOUS-APPROVED.mp4 CANDIDATE.mp4 -t 9 --roi .22 .68 .75 1
```

Pair it with the AQNF t=14 shadow gate. The runtime's 64x64 local-bias texture
may strengthen only the already-approved mip 0-2 Gaussian field; bright cores
stay max-channel-pinned while coherent same-hue light may fill their gaps;
coarse mips 3-4 must remain zero.

| Strategy | What it does |
|---|---|
| `chroma-shoulder` | Historical hue-locked shoulder baseline retained for comparisons. |
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
- The dev server runs on a fixed port (`--dev-port`, default 5199). A server
  that is already answering on that port is reused and never touched. A server
  the run spawned itself is killed — whole process tree (npm → node → Vite →
  esbuild), via `taskkill /T` on Windows — when the run exits, including on
  Ctrl-C and crashes (atexit). Pass `--keep-server` on batch workflows to
  leave a spawned server warm for the next invocation; kill it yourself when
  the batch is done. Orphaned node/esbuild trees from the old always-leave-it
  behavior were observed burning CPU indefinitely, which is why teardown is
  the default.
- The producer refuses to overwrite an existing package, so the script renders
  into a temp directory and copies both the MP4 and the ZIP into the output
  directory itself. Temp state is always cleaned up.

`docs/production-cli.md` documents the underlying job-URL parameters for cases
this wrapper does not cover.
