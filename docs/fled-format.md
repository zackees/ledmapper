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
| `0x05`–`0xFF` |       | —         | —                         | Reserved.                          |

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
    "fps": 60
  }
}
```

| field         | required | notes                                                           |
|---------------|----------|-----------------------------------------------------------------|
| `map`         | yes      | Standard `ScreenMap` schema. LED count derives from the total point count across all strips. |
| `video.fps`   | no       | Playback frame rate. Consumers default to 30 if absent (the rate every ledmapper recording used before the key was written; issue #256). The Mapped Video Maker writes the detected source rate. |

Authors **must not** write `video.format` — it would be a redundant second
source of truth. Consumers **must** ignore any `video.format` key if
present (a v1 reader cannot trust JSON over the header).

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
tests. A minimal valid file is:

- header: `46 4C 45 44 01 00 00 00 <json_length_u32_LE>`
- JSON:   `{"map":{"a":{"x":[0],"y":[0]}}}` (31 bytes UTF-8)
- payload: `FF 00 00` (one frame, one LED, pure red)
- total file size: 12 + 31 + 3 = 46 bytes

A "metadata-only" `.fled` with zero frames (12 + 31 = 43 bytes) is valid
and useful as a screenmap-only carrier.

## See also

- Generator tracking issue: [zackees/ledmapper#122](https://github.com/zackees/ledmapper/issues/122)
- Consumer tracking issue: [FastLED/FastLED#3063](https://github.com/FastLED/FastLED/issues/3063)
