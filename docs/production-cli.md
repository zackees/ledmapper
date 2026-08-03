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
