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
uv run python scripts/produce_mapped_video.py "E:\video\short\clip.mp4" `
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

For the `acrylic-pane` strategy, source-frequency adaptation is automatic. The
renderer measures axial and diagonal luma/chroma disagreement on the raw 64×64
LED lattice, then continuously moves bloom energy between a coherent-surface
profile and a fine-detail profile. A media-time attack/decay filter prevents
cuts and one-frame quiet patches from pumping the bloom. Mips 3–4 remain hard
disabled in every profile; adaptation only redistributes the approved local
mips 0–2.

Use deterministic pins when making evaluator renders:

```powershell
# Pin either endpoint, or an exact point on the continuous curve.
uv run python scripts/produce_mapped_video.py "E:\video\short\clip.mp4" `
  --strategy acrylic-pane --bloom-frequency-mode high --version freq-high
uv run python scripts/produce_mapped_video.py "E:\video\short\clip.mp4" `
  --strategy acrylic-pane --bloom-frequency-blend 0.5 --version freq-mid
```

Compare an adaptive candidate against the fixed-mip baseline with the
frequency-conditioned ratchet (high and low regimes are scored separately):

```powershell
uv run python scripts/frequency_adaptive_bloom_gate.py SOURCE-CROP.mp4 `
  FIXED-MIPS.mp4 ADAPTIVE.mp4 --regime high -t 2 -t 4 -t 7
```

The temporal fixture gate verifies that the rendered encoder—not only the
pure controller—reaches the documented attack/decay response and ignores a
one-frame frequency impulse:

```powershell
uv run python scripts/frequency_temporal_bloom_gate.py `
  TEMPORAL-SOURCE-CROP.mp4 PINNED-LOW.mp4 PINNED-HIGH.mp4 `
  TEMPORAL-ADAPTIVE.mp4
```

The gate fits every encoded adaptive frame between the same-frame pinned
endpoints in linear RGB. A source-only reconstruction, controller reset, or
instant endpoint jump therefore cannot masquerade as a passing temporal test.

Dark colored structure has a separate upper-bound ratchet. It samples both
LED cores and the axial/diagonal midpoints between them, so correct core values
cannot hide bloom-filled negative space. Use a fixture-specific ROI; this is
the AQNFgVV hair-shadow probe at 14 seconds:

```powershell
uv run python scripts/shadow_structure_gate.py SOURCE-CROP.mp4 CANDIDATE.mp4 `
  --reference MINIMAL-BLOOM.mp4 -t 14 --roi 0 0 0.58 0.92
```

The coherent-fill evaluator deliberately starts at visibly driven source
values; blue-black hair belongs to the shadow ceiling, while faces and petals
belong to the fill floor. Run both gates when changing bloom support.

Globally dark but locally coherent footage has its own overlap floor. The
acrylic composite reaches full local splat overlap earlier in dark scenes and
later in bright coherent scenes; this uses the existing filtered global-light
signal only for the overlap curve and does not change exposure, capture
strength, LED diameter, or mip selection. AQPoUmw is the regression fixture:

```powershell
uv run python scripts/low_light_splat_gate.py SOURCE-CROP.mp4 `
  FIXED-MIPS.mp4 ADAPTIVE.mp4 `
  -t .5 -t 1.5 -t 2.5 -t 3.5 -t 4.5 -t 5.5 -t 6.5 -t 7.5
```

The gate requires positive axial and diagonal midpoint-fill gains across the
dark sequence while bounding the worst individual-frame regression. Always run
it alongside the AQNF hair-shadow ceiling and AQP high-frequency chroma gate;
none of the three is a substitute for another.

Coherent low/mid regions also use a spatial 64x64 bloom-bias texture. It is
computed from raw LED luma/chromaticity agreement, interpolated across axial
and diagonal neighbours, and filtered independently per cell (0.22 s opening,
0.10 s protective close). It modestly strengthens the already-approved local
mip 0-2 Gaussian field; bright cores stay on the global profile while their
coherent same-hue field may still fill surrounding negative space, and coarse
mips 3-4 remain disabled. AQNFgVV's blue neck piece at 9 seconds is the fill
floor, paired with the 14-second hair-shadow ceiling:

```powershell
uv run python scripts/local_midtone_bias_gate.py SOURCE-CROP.mp4 `
  PREVIOUS-APPROVED.mp4 CANDIDATE.mp4 -t 9 --roi .22 .68 .75 1
uv run python scripts/shadow_structure_gate.py SOURCE-CROP.mp4 CANDIDATE.mp4 `
  --reference MINIMAL-BLOOM.mp4 -t 14 --roi 0 0 .58 .92
```

The local gate reports the old deficit explicitly (`baseline_underfilled_fraction`)
and ratchets lower-quartile and diagonal midpoint gains while bounding changes
to bright LED cores. A whole-frame midpoint score is not a substitute: the
bright face can hide an under-filled blue neck region.

Rare core/halo color mismatches have a separate radial ratchet. A dim blue LED
can become a dark, highly saturated pin inside a brighter halo when surrounding
energy reaches the Gaussian annulus but is rejected at the core. DYNLe locks
both the gray-field case at frame 0 and the yellow-outline case at 1 second;
the latter cannot be found by whole-frame energy because the yellow contour
makes that aggregate brighter. Run the gate with the render's actual panel
rotation:

```powershell
uv run python scripts/core_halo_consistency_gate.py MAPPED.mp4 `
  --reference PREVIOUS-APPROVED-MAPPED.mp4 `
  -t 0 -t 1 --panel-rotation 45
```

The approved reference selects a fixed population of blue cores; the candidate
cannot escape judgment by brightening, desaturating, or recoloring those cells.
The gate reports the worst LED grid/pixel coordinate, core/halo luma ratio,
hue separation, and whether the ambient is neutral, opponent-warm, or another
cross-hue field. It multiplies halo-over-core luma inversion by the larger of
saturation loss and cross-hue chroma mismatch. Neutral haze remains fully
weighted because its hue is undefined; a saturated opponent halo cannot score
zero merely because it retained saturation, while hue-consistent blue diffusion
is explicitly not an error. Independent reference-relative ceilings on core
hue drift, saturation loss, and two-sided value/luma drift prevent a fix from hiding
the halo defect by altering the LED core itself. Both fixes recolor only an
existing neutral/opponent, already-admitted
mip-0/1/2 Gaussian toward the local source-blue hue while preserving that field's
max-channel energy. They therefore spread the dark halo instead of adding
gray/yellow light to the neighborhood or core. Linear RGB still owns halo
energy and falloff; the hue guide changes only the channel ratio. Same-hue blue
Gaussian energy is left unchanged, cross-hue chromatic spill remains guarded,
and coarse mips 3-4 remain disabled.
