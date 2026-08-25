# FLED Video Container Format — v1

A self-describing container for LED-data video files. A `.fled` file holds
raw pixel frames for an LED layout alongside the screenmap that drove the
recording, so a video and its display geometry stay paired in one file.

This document is the canonical spec. The generator lives at
[ledmapper](https://github.com/zackees/ledmapper) and the consumer lives at
[FastLED](https://github.com/FastLED/FastLED).

## Status

| Property        | Value                              |
|-----------------|------------------------------------|
| Format version  | **1**                              |
| File extension  | **`.fled`**                        |
| MIME type       | `application/vnd.fastled.video`    |
| Magic           | `FLED` (`0x46 0x4C 0x45 0x44`)     |
| Endianness      | little-endian (every multi-byte field) |

## File layout

| offset | size | field          | notes                                                  |
|--------|------|----------------|--------------------------------------------------------|
| 0      | 4    | `magic`        | ASCII `FLED`                                           |
| 4      | 1    | `version`      | `u8`, currently `1`                                    |
| 5      | 1    | `pixel_format` | `u8` enum (see below)                                  |
| 6      | 2    | `reserved`     | must be 0                                              |
| 8      | 4    | `json_length`  | `u32` LE — length of JSON in bytes                     |
| 12     | N    | `json_bytes`   | UTF-8 JSON, no NUL terminator, no BOM                  |
| 12 + N | …    | `payload`      | frame data, stride = `ledCount × bytesPerLed[format]`  |

The fixed header is 12 bytes. `json_length` is variable (typically 100–2000
bytes). Total payload size is `frame_count × ledCount × bytesPerLed`.

## Pixel format enum

| value  | name        | bytes/LED | channel order             | notes                              |
|--------|-------------|-----------|---------------------------|------------------------------------|
| `0x00` | `rgb8`      | 3         | R, G, B                   | Default. Phase 1 generator emits only this. |
| `0x01` | `gray8`     | 1         | V                         | Brightness or effect mask.         |
| `0x02` | `rgba8`     | 4         | R, G, B, A                | Canvas-native; alpha = effect.     |
| `0x03` | `rgbw8`     | 4         | R, G, B, W                | SK6812 RGBW strips.                |
| `0x04` | `rgb565le`  | 2         | RRRRR GGGGGG BBBBB (LE)   | 16-bit packed, little-endian.      |
| `0x05` | `rgb16_linear` | 6      | R, G, B (`u16` LE each)   | Linear-light. Requires `transfer: "linear"`. |
| `0x06`–`0xFF` |       | —         | —                         | Reserved.                          |

Consumers **must** reject unknown `pixel_format` values with a clear error
("video format `0xNN` is not supported by this player"). They must **not**
attempt to fall back to `rgb8` on unknown values.

## JSON payload

A superset of the existing screenmap.json. The pixel format is
deliberately **not** carried in JSON — it lives in the binary header so
consumers can slice frames without parsing JSON at all.

```json
{
  "map": {
    "strip1": { "x": [0.0, 1.0], "y": [0.0, 0.0], "diameter": 0.25 }
  },
  "video": {
    "fps": 60,
    "color": {
      "primaries": "bt709",
      "transfer": "srgb",
      "matrix": "rgb",
      "range": "full"
    }
  }
}
```

| field         | required | notes                                                           |
|---------------|----------|-----------------------------------------------------------------|
| `map`         | yes      | Standard `ScreenMap` schema. LED count derives from the total point count across all strips. |
| `video.fps`   | no       | Playback frame rate. Consumers default to 30 if absent (the rate every ledmapper recording used before the key was written; issue #256). The Mapped Video Maker writes the detected source rate. |
| `video.color` | no       | Color encoding of the payload. See "Source color metadata" below. Absent metadata retains the historical interpretation of display-encoded RGB8. |

`rgb8` is display-encoded, not linear-light data. Producers that process video
in linear light must apply the declared transfer function and quantize once
when writing the payload. A linear or higher-precision payload uses
`rgb16_linear` (or a future enum value); it must not be silently stored as
`rgb8`.

Authors **must not** write `video.format` — it would be a redundant second
source of truth. Consumers **must** ignore any `video.format` key if
present (a v1 reader cannot trust JSON over the header).

## Source color metadata

`video.color` describes how the payload's numbers encode color. It describes
the **encoded payload only** — independently of LED layout, output chipset, and
the physical emitter profile of the strip that will display it.

This section is machine-enforced. The reference implementation is
`packages/gfx/src/render/fled-color.ts` (`validateFledColor`), its test suite is
`tests/unit/fled-color.test.ts`, and the FastLED consumer mirrors the same rules
in `src/fl/fled/color.h` with tests in `tests/fl/fled/fled_color.cpp`. A rule
stated here without a test on both sides is a bug in this document.

The four fields are independent and must never be collapsed into a single
ambiguous label such as "BT.709":

| field | v1 values | meaning |
|-------|-----------|---------|
| `primaries` | `bt709`, `display-p3`, `bt2020`, or a custom object | Chromaticities + white point. `bt709` means the BT.709/sRGB primaries with D65 white. |
| `transfer` | `srgb`, `bt709`, `linear` | The transfer function. `srgb` is the piecewise sRGB function — it is **not** the BT.709 camera OETF and must not be approximated by an unnamed power law. |
| `matrix` | `rgb` | The payload carries direct RGB components; the identity/no-matrix case. YCbCr coefficient sets are reserved. |
| `range` | `full` | All codes are image values: for 8-bit, `0` is black and `255` is full channel. `limited` is reserved. |

A custom `primaries` object carries CIE xy pairs:

```json
"primaries": {
  "red":   [0.640, 0.330],
  "green": [0.300, 0.600],
  "blue":  [0.150, 0.060],
  "white": [0.3127, 0.3290]
}
```

`"none"` is not a valid `transfer` value — it is ambiguous. Producers with
genuinely linear-light samples declare `transfer: "linear"` and use a pixel
format whose semantics permit linear data (`rgb16_linear`).

### Default tuple

The canonical default tuple is:

```json
{ "primaries": "bt709", "transfer": "srgb", "matrix": "rgb", "range": "full" }
```

When `video.color` is **absent**, a payload whose pixel format defines a default
tuple is interpreted as that tuple — for the display-encoded RGB formats this
preserves the historical interpretation of `.fled` RGB8 data. Individual missing
keys inherit from the same tuple, but **only** for pixel formats that define
one. Do not describe this default as merely "BT.709"; that leaves the transfer
function unresolved.

### Color classes by pixel format

| pixel_format | color class | default tuple | constraint |
|--------------|-------------|---------------|------------|
| `rgb8`, `rgba8`, `rgb565le` | display-encoded RGB | `{bt709, srgb, rgb, full}` | `transfer` must be `srgb` or `bt709` |
| `rgb16_linear` | linear-light RGB | `{bt709, linear, rgb, full}` | `transfer` must be `linear` |
| `gray8`, `rgbw8` | no defined tuple | none | `video.color` must declare all four keys or be absent |

`gray8` carries no chromaticity and `rgbw8`'s white is a device primary that RGB
primaries cannot describe, so neither format inherits a default tuple. Scoping
inheritance this way is what stops a future YCbCr format from silently
inheriting `matrix: "rgb"`.

### Validation rules

A conforming producer must not write, and a conforming validator must reject:

1. any unrecognized value in any of the four fields — reject with a clear
   diagnostic naming the field and value; never silently fall back;
2. `transfer` of `linear`, `pq`, or `hlg` on a display-encoded RGB format;
3. `rgb16_linear` with any `transfer` other than `linear`;
4. `range: "limited"` on any v1 format — reserved for explicitly labeled
   future/imported payloads;
5. any `matrix` other than `rgb` in v1 — a YCbCr payload needs a pixel format
   that does not exist yet, and must then declare its coefficients explicitly;
6. a partial `video.color` on a pixel format with no default tuple;
7. `video.color` present but not a JSON object, or a custom `primaries` object
   missing a key or carrying a malformed xy pair.

`pq` and `hlg` are reserved transfer names, rejected in v1: a 16-bit linear
integer payload cannot faithfully carry PQ-decoded content, so HDR transfers
wait for a payload format and working domain that can.

An **absent** declaration is never an error for a format with a default tuple —
every pre-`video.color` recording must keep playing. Only a declaration that is
present and invalid is rejected.

### Forward compatibility

`video.color` is **advisory** for the display-encoded RGB formats. A reader that
predates this section ignores the key and lands on exactly the default tuple, so
old readers degrade to reduced fidelity, never to wrong data. That is why adding
`video.color` is not a version bump.

Payloads whose color semantics are **mandatory** rather than advisory gate on a
new `pixel_format` value instead: `rgb16_linear` is meaningless without its
declaration, and readers that predate it already reject unknown pixel formats.
Mandatory-ness is a property of the payload format, not a version flag.

## Versioning

- `version` starts at `1`. A bump is required for any breaking change to:
  - the binary header layout
  - the JSON schema (required fields, type changes)
  - existing pixel-format enum semantics
- Adding a **new** value to the `pixel_format` enum is **not** a version
  bump — unknown values already have a defined rejection behavior, so
  forward-compatibility is free.
- A v1 consumer encountering a `version` > 1 file **must** reject it with
  "format version `N` is not supported".

## Backwards compatibility with legacy `.rgb`

Files without the `FLED` magic in the first 4 bytes are not FLED files.
Tools that previously read raw headerless `.rgb` (the legacy format
produced before this spec) should magic-check before assuming the format:

- **Movie Player** rejects legacy headerless files outright. Users must
  re-record with the current Mapped Video Maker to get an embedded
  screenmap.
- The **Mapped Video Maker** only emits `.fled` files going forward.
  Legacy headerless `.rgb` is never written again.

## Test vectors

The canonical reference vectors live in
`tests/unit/rgb-video.test.ts` (ledmapper) and the equivalent FastLED
tests; the `video.color` contract has its own vectors in
`tests/unit/fled-color.test.ts` and `tests/fl/fled/fled_color.cpp`.
A minimal valid file is:

- header: `46 4C 45 44 01 00 00 00 <json_length_u32_LE>`
- JSON:   `{"map":{"a":{"x":[0],"y":[0]}}}` (31 bytes UTF-8)
- payload: `FF 00 00` (one frame, one LED, pure red)
- total file size: 12 + 31 + 3 = 46 bytes

A "metadata-only" `.fled` with zero frames (12 + 31 = 43 bytes) is valid
and useful as a screenmap-only carrier.

## See also

- Generator tracking issue: [zackees/ledmapper#122](https://github.com/zackees/ledmapper/issues/122)
- Consumer tracking issue: [FastLED/FastLED#3063](https://github.com/FastLED/FastLED/issues/3063)
