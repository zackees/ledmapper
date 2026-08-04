#!/usr/bin/env python3
"""Measure direct artifact materialization against bounded sidecar streaming."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import tempfile
import tracemalloc
from pathlib import Path

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("production_sidecar", ROOT / "scripts" / "production_sidecar.py")
assert SPEC and SPEC.loader
sidecar = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sidecar
SPEC.loader.exec_module(sidecar)


class GeneratedBody:
    """Deterministic source that never retains the complete artifact."""
    def __init__(self, total: int, chunk_size: int) -> None:
        self.remaining, self.chunk_size, self.offset = total, chunk_size, 0

    def read(self, maximum: int = -1) -> bytes:
        if not self.remaining:
            return b""
        size = min(self.remaining, self.chunk_size, maximum if maximum >= 0 else self.chunk_size)
        chunk = b"ledmapper-sidecar-benchmark\n" * (size // 28) + b"x" * (size % 28)
        chunk = chunk[:size]
        self.remaining -= size; self.offset += size
        return chunk


def _peak(callable_):
    tracemalloc.start()
    try:
        value = callable_()
        return value, tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()


def _direct_materialize(total: int, chunk_size: int) -> tuple[int, str]:
    body = GeneratedBody(total, chunk_size)
    artifact = bytearray()
    while chunk := body.read(): artifact.extend(chunk)
    return len(artifact), hashlib.sha256(artifact).hexdigest()


def run_benchmark(workload_bytes: int = 64 * 1024 * 1024, chunk_size: int = 1024 * 1024) -> dict[str, object]:
    if workload_bytes <= 0 or chunk_size <= 0:
        raise ValueError("workload_bytes and chunk_size must be positive")
    (direct_size, direct_sha), direct_peak = _peak(lambda: _direct_materialize(workload_bytes, chunk_size))
    with tempfile.TemporaryDirectory(prefix="ledmapper-sidecar-benchmark-") as raw:
        root = Path(raw); video = root / "video.mp4"; video.write_bytes(b"v")
        screenmap = root / "screenmap.json"; screenmap.write_text("{}")
        service = sidecar.ProductionSidecar(root / "jobs", max_request_bytes=workload_bytes + 1, max_total_bytes=workload_bytes + 1)
        try:
            token = service.register_job("benchmark", video=video, screenmap=screenmap)
            item, sidecar_peak = _peak(lambda: service.put_artifact(
                "benchmark", token, "fled", "application/vnd.fastled.video", GeneratedBody(workload_bytes, chunk_size), None,
            ))
            service.complete("benchmark", token, {"artifacts": {"fled": {"byteSize": item.byte_size, "sha256": item.sha256}}})
        finally:
            service.close()
    return {
        "workloadBytes": workload_bytes, "chunkBytes": chunk_size,
        "directPeakBytes": direct_peak, "sidecarPeakBytes": sidecar_peak,
        "directArtifactBytes": direct_size, "sidecarArtifactBytes": item.byte_size,
        "sidecarIntegrityVerified": item.sha256 == direct_sha,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bytes", type=int, default=64 * 1024 * 1024)
    parser.add_argument("--chunk-bytes", type=int, default=1024 * 1024)
    args = parser.parse_args()
    print(json.dumps(run_benchmark(args.bytes, args.chunk_bytes), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
