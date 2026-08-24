# FastLED Video Mapper

[![Deploy](https://github.com/zackees/ledmapper/actions/workflows/deploy.yml/badge.svg)](https://github.com/zackees/ledmapper/actions/workflows/deploy.yml)
[![Test](https://github.com/zackees/ledmapper/actions/workflows/test.yml/badge.svg)](https://github.com/zackees/ledmapper/actions/workflows/test.yml)
[![Lint](https://github.com/zackees/ledmapper/actions/workflows/lint.yml/badge.svg)](https://github.com/zackees/ledmapper/actions/workflows/lint.yml)

![temp](https://github.com/user-attachments/assets/37c20ca6-c26e-42f4-8d5d-34ded90ca946)

A web-based tool suite for mapping video content to physical LED arrays (WS2812/APA102).

**Live site:** [www.ledmapper.com](https://www.ledmapper.com)

## Mobile support

Ledmapper supports current stable iOS Safari and Android Chrome on phone-sized
viewports in portrait and landscape. See the
[mobile validation guide](docs/mobile-validation.md) for the automated matrix,
physical-device release checklist, and evidence template.

## Unattended production

The Python/Playwright producer for versioned `/produce` jobs is documented in the
[production CLI guide](docs/production-cli.md).

For the common local workflow, use the one-command wrapper. This example writes
both the 1024×1024 mapped render and a 1536×1024 review video to
`E:\video\short_out`:

```powershell
python scripts/produce_mapped_video.py "E:\video\short\clip.mp4" `
  --video-mode mapped-led --panel-rotation 0 --strategy acrylic-pane `
  --version batch --final-artifact --no-stitch --no-open
```

`--final-artifact` gives the review video a fixed one-third/two-thirds layout:
the original is aspect-fitted and letterboxed into the left 512×1024 pane, and
the mapped LED render occupies the right 1024×1024 pane. The output name ends in
`-dual.mp4`. `--no-stitch` avoids creating the wrapper's additional 50/50
comparison splice. Do not add `--crop-source` when this one-third layout is the
desired final artifact; that option intentionally creates separate 50/50
cropped-source comparisons.
