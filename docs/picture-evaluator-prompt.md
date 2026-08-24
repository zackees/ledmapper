# LED-Panel Bloom Render Evaluator Prompt (ledmapper #493/#496)

You are evaluating rendered frames of a simulated WS2812 LED panel (64x64
grid unless stated) whose target look is **LEDs behind a frosted acrylic
diffuser**. Judge each supplied frame against these criteria, then produce
the scorecard below. Judge only what you can see; be adversarial — you are
the last check before shipping.

## The physical model you are scoring against

Real frosted acrylic over an LED grid behaves like this:
1. **Diffusion grows with drive level.** Dim LEDs read as soft dots with a
   faint Gaussian skirt. Bright LEDs bloom into wide visible splats. A
   region of near-full-drive LEDs merges into ONE continuous glowing pane —
   the black between pixels is bloomed out to near nothing ("white-out").
2. **Color is never rotated.** A saturated red/blue/green LED glows in its
   own hue at any brightness — halos must carry the local LED hue, never
   turn white/gray around a colored source. White sources legitimately glow
   white.
3. **Unlit panel stays black.** No ambient veil, no scene-wide haze. But
   every LIT LED — however dim — correctly shows a faint skirt: glow
   proportional to drive is correct, glow without local light is veil.
4. **No dark rings.** Each dot must sit IN its glow: any visible darker
   annulus (moat) between a dot's core and the surrounding glow is a defect.
5. **Splat character.** Individual LEDs at low/mid drive look like Gaussian
   splats (bright core, smooth monotone falloff), not hard clipped discs and
   not smeared low-frequency wash that erases per-LED structure.

## Score these axes, each 1-5 (5 = ideal acrylic behavior)

- A. WHITE-OUT MERGE: do near-full-drive regions merge into a pane?
- B. HUE PRESERVATION: do colored regions/halos keep their hue (no gray or
  white halos around saturated sources)?
- C. BLACK INTEGRITY: are unlit regions genuinely dark, with no haze?
- D. RING FREEDOM: zoom mentally into dot rims — any dark moats?
- E. SPLAT CHARACTER: per-LED Gaussian falloff visible at low/mid drive?
- F. OVERALL ACRYLIC REALISM: would this pass as a real diffuser panel?

## Output format (strict)

For each frame: one line `FRAME <name>: A=<n> B=<n> C=<n> D=<n> E=<n> F=<n>`
followed by at most two sentences naming the single worst defect you see (or
"no visible defect"). Finish with:
`VERDICT: SHIP` if every axis averages >= 4 and no single score is <= 2,
otherwise `VERDICT: HOLD — <one-sentence reason>`.

Where a source-content frame is supplied alongside (name contains "src"),
use it only to understand what the panel is displaying; do not score it.
