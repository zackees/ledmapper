# Production CLI

The supported unattended producer downloads a job's input ZIP, validates and extracts it, drives the LED Mapper `/produce` browser API, and writes one output ZIP containing `manifest.json` and the requested `.fled`, `.mp4`, or both.

## Install

Python 3.10 or newer is required. Use a dedicated virtual environment where practical:

```bash
python -m pip install -r scripts/requirements-production.txt
python -m playwright install chromium
```

## Run

```bash
python scripts/produce_video_mapping.py \
  'https://www.ledmapper.com/produce/?v=1&input=https%3A%2F%2Fexample.com%2Fjob.zip&output=both' \
  --output-dir ./output
```

The input ZIP must contain exactly one `.mp4` and one case-sensitive `screenmap.json`, either at its root or together inside one enclosing directory. The CLI prints the completed `<source>-ledmapper-v1.zip` path on stdout. Failures are emitted as structured JSON on stderr and return a nonzero categorized exit code.

For unattended safety, input URLs with credentials and hosts resolving to loopback, private, link-local, reserved, or otherwise non-public addresses are rejected. A trusted local development workflow may opt in explicitly:

```bash
python scripts/produce_video_mapping.py 'http://localhost:5173/produce/?v=1&input=http%3A%2F%2Flocalhost%3A8000%2Fjob.zip&output=fled' --output-dir ./output --allow-private-network
```

`--allow-private-network` changes only the input-archive network policy. The exact job route URL is still passed to Chromium. Use `--headed` to show Chromium for diagnostics and `--timeout SECONDS` to adjust the production deadline.

## Direct versus sidecar transport

Direct Playwright transport is the default and the recommended option whenever the
producer controls Chromium. It injects local files and persists ordinary browser
downloads; it starts no listener and keeps the GitHub Pages deployment completely
static.

The optional sidecar is for a browser running on another host/container or for
jobs where streaming artifacts is necessary to avoid completed browser Blobs. A
trusted automation controller, not the public `/produce` URL, supplies the
sidecar `endpoint`, `jobId`, and capability token through
`window.__lmProduction.provideInputFromSidecar(...)` and
`window.__lmProduction.start({ sidecar: ... })`. Never put those values in a job
URL, log them, or copy them into a manifest.

`scripts/production_sidecar.py` is loopback-only by default. It serves only
pre-registered `video` and `screenmap` inputs and accepts only fixed `fled` and
`mp4` artifact names. It enforces short-lived per-job capabilities, configured
origins, request/total-size limits, streaming uploads, hash/byte-count
finalization, and cleanup after cancellation, expiry, or deletion. A non-loopback
bind requires the explicit `--allow-private-bind` opt-in and a narrowly configured
browser origin.

Choose the sidecar only when its remote-execution boundary or streaming behavior
is measurable for your workload. For local Playwright jobs it adds deployment and
network risk without reducing input transfer overhead.

Run the reproducible memory comparison before choosing it for a large artifact:

```bash
python scripts/benchmark_production_sidecar.py --bytes 67108864
```

The JSON result compares a direct completed-artifact materialization with the
same bounded sidecar upload and integrity finalization. `directPeakBytes` is
expected to scale with the full artifact; `sidecarPeakBytes` stays near the
configured chunk size. Remote execution is independently proven by the
isolated Chromium/sidecar container test below. Static GitHub Pages jobs retain
the direct transport by default.

## Isolated-container proof

The Docker-backed Chromium proof has no producer-file bind mount. It starts a
private sidecar and browser containers, retrieves the registered inputs, uploads
a FLED artifact, and verifies the completed SHA-256 metadata. The separate
sidecar protocol tests cover its chunked streaming decoder and byte limits:

```bash
python scripts/test_production_sidecar_isolation.py
```

It requires Docker Desktop and pulls the pinned Playwright image on first run.

## Output

The final archive uses DEFLATE compression level 1 and contains only:

- `manifest.json`, with normalized contract configuration, input archive metadata and SHA-256, app metadata when exposed by the route, render frame count/FPS, timestamps, and artifact metadata/hashes
- the requested nonempty `.fled` and/or H.264 `.mp4` browser downloads

The output ZIP is built in the destination directory and atomically replaced only after it has been finalized.

## Python unit tests

The archive, URL/network-policy, redaction, manifest, and output-ZIP helpers are testable without Playwright installed:

```bash
python -m unittest discover -s tests/python -v
```
