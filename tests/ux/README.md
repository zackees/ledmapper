# UX walkthrough harness

`walkthrough.mjs` drives the **full user pipeline** end to end in a headed
Chromium via Playwright, as a brand-new user would experience it:

1. `/` (default route) and `/hub` — first impressions
2. `/screenmap` — create a screenmap with the (fake) webcam, click 8 LED
   positions, export JSON
3. `/shapeeditor` — load the exported screenmap
4. `/moviemaker` — import a real video file, apply the screenmap, record a
   `.fled`
5. `/movieplayer` — load the `.fled`, verify frames actually advance

## Running

```bash
npm run dev          # in one terminal
node tests/ux/walkthrough.mjs
```

Options (env vars):

- `LM_UX_VIDEO` — video file to import (default `E:/video/color_bubble_swirl.mp4`,
  falls back to `tests/fixtures/test-video.mp4` when missing)
- `LM_UX_BASE` — server origin (default `https://localhost:8080`)

## Output — `tests/ux/out/` (gitignored)

- `NN-step-name.png` — a screenshot per step, numbered in pipeline order.
  Review these (human eyes or a vision model) for UX problems: dead ends,
  black previews, missing affordances, layout breakage.
- `ux-log.json` — step timeline, UX probes (element states asserted during
  the run), console/page errors, and the in-page `window.__lmLog` event
  trail from moviemaker + movieplayer.
- `created-screenmap.json` / `recorded.fled` — the pipeline artifacts; the
  `.fled` proves the record path produced playable output.

Headed mode is required: WebGL readback recording needs a real GPU context.

This harness is intentionally *not* a pass/fail spec — it is an instrumented
tour that produces evidence for usability review. Hard functional
regressions it uncovers should graduate into `tests/integration/` specs
(see `moviemaker-preset-recording.spec.ts` for one that started here).
