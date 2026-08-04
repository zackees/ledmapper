#!/usr/bin/env python3
"""Bounded, capability-authenticated sidecar for production jobs.

The service deliberately has no endpoint that accepts a filesystem path.  A
trusted producer registers files before issuing a job capability; browser
clients can subsequently address only a job id and one of the fixed names.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import tempfile
import threading
import time
from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO

JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
TOKEN_BYTES = 32
CHUNK_BYTES = 1024 * 1024
INPUT_SPECS = {"video": ("video.mp4", "video/mp4"), "screenmap": ("screenmap.json", "application/json")}
ARTIFACT_SPECS = {"fled": ("result.fled", "application/vnd.fastled.video"), "mp4": ("result.mp4", "video/mp4")}


class SidecarError(Exception):
    def __init__(self, code: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST):
        super().__init__(code)
        self.code = code
        self.status = status


@dataclass
class Artifact:
    path: Path
    byte_size: int
    sha256: str
    mime_type: str


@dataclass
class Job:
    job_id: str
    token: str
    directory: Path
    expires_at: float
    inputs: dict[str, Path]
    max_request_bytes: int
    max_total_bytes: int
    artifacts: dict[str, Artifact] = field(default_factory=dict)
    uploading: set[str] = field(default_factory=set)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


class ProductionSidecar:
    """Thread-safe job registry and HTTP protocol implementation."""

    def __init__(self, root: Path | None = None, *, ttl_seconds: float = 900,
                 max_request_bytes: int = 2 * 1024 * 1024 * 1024,
                 max_total_bytes: int = 4 * 1024 * 1024 * 1024,
                 max_concurrent_uploads: int = 2) -> None:
        if ttl_seconds <= 0 or max_request_bytes <= 0 or max_total_bytes <= 0 or max_concurrent_uploads <= 0:
            raise ValueError("sidecar limits must be positive")
        self._temporary = root is None
        self.root = Path(tempfile.mkdtemp(prefix="ledmapper-sidecar-")) if root is None else Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.ttl_seconds = ttl_seconds
        self.max_request_bytes = max_request_bytes
        self.max_total_bytes = max_total_bytes
        self.max_concurrent_uploads = max_concurrent_uploads
        self.jobs: dict[str, Job] = {}
        self._lock = threading.RLock()
        self.clean_stale()

    def close(self) -> None:
        with self._lock:
            for job_id in list(self.jobs):
                self.delete_job(job_id)
            if self._temporary:
                shutil.rmtree(self.root, ignore_errors=True)

    def clean_stale(self) -> None:
        """Remove on-disk job remnants left by an interrupted prior process."""
        with self._lock:
            for child in self.root.iterdir():
                if child.is_dir():
                    shutil.rmtree(child, ignore_errors=True)

    def register_job(self, job_id: str, *, video: Path, screenmap: Path) -> str:
        if not JOB_ID_RE.fullmatch(job_id):
            raise ValueError("invalid job id")
        video, screenmap = Path(video), Path(screenmap)
        if not video.is_file() or not screenmap.is_file():
            raise ValueError("registered inputs must be files")
        with self._lock:
            self.sweep_expired()
            if job_id in self.jobs:
                raise ValueError("duplicate job id")
            directory = self.root / job_id
            directory.mkdir(mode=0o700)
            input_dir = directory / "inputs"
            input_dir.mkdir(mode=0o700)
            copied: dict[str, Path] = {}
            for name, source in (("video", video), ("screenmap", screenmap)):
                target = input_dir / INPUT_SPECS[name][0]
                shutil.copyfile(source, target)
                copied[name] = target
            token = secrets.token_urlsafe(TOKEN_BYTES)
            self.jobs[job_id] = Job(job_id, token, directory, time.monotonic() + self.ttl_seconds,
                                    copied, self.max_request_bytes, self.max_total_bytes)
            return token

    def sweep_expired(self) -> None:
        now = time.monotonic()
        for job_id in [key for key, job in self.jobs.items() if job.expires_at <= now]:
            self.delete_job(job_id)

    def delete_job(self, job_id: str) -> None:
        job = self.jobs.pop(job_id, None)
        if job:
            shutil.rmtree(job.directory, ignore_errors=True)

    def _job(self, job_id: str, token: str) -> Job:
        if not JOB_ID_RE.fullmatch(job_id):
            raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
        with self._lock:
            self.sweep_expired()
            job = self.jobs.get(job_id)
            if not job:
                raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
            if not hmac.compare_digest(job.token, token):
                raise SidecarError("UNAUTHORIZED", HTTPStatus.UNAUTHORIZED)
            return job

    def input(self, job_id: str, token: str, name: str) -> tuple[Path, str]:
        job = self._job(job_id, token)
        if name not in INPUT_SPECS:
            raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
        return job.inputs[name], INPUT_SPECS[name][1]

    def put_artifact(self, job_id: str, token: str, name: str, content_type: str,
                     source: BinaryIO, content_length: int | None) -> Artifact:
        job = self._job(job_id, token)
        if name not in ARTIFACT_SPECS:
            raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
        if content_type.split(";", 1)[0].strip().lower() != ARTIFACT_SPECS[name][1]:
            raise SidecarError("INVALID_CONTENT_TYPE", HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        if content_length is not None and (content_length < 0 or content_length > job.max_request_bytes):
            raise SidecarError("REQUEST_TOO_LARGE", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        with self._lock:
            if len(job.uploading) >= self.max_concurrent_uploads or name in job.uploading:
                raise SidecarError("UPLOAD_BUSY", HTTPStatus.TOO_MANY_REQUESTS)
            old_size = job.artifacts.get(name).byte_size if name in job.artifacts else 0
            if content_length is not None and sum(item.byte_size for item in job.artifacts.values()) - old_size + content_length > job.max_total_bytes:
                raise SidecarError("TOTAL_TOO_LARGE", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            job.uploading.add(name)
        part = job.directory / f".{name}.part"
        target = job.directory / ARTIFACT_SPECS[name][0]
        digest, total = hashlib.sha256(), 0
        try:
            with part.open("xb") as output:
                while content_length is None or total < content_length:
                    chunk = source.read(CHUNK_BYTES if content_length is None else min(CHUNK_BYTES, content_length - total))
                    if not chunk:
                        if content_length is None: break
                        raise SidecarError("INTERRUPTED_UPLOAD")
                    total += len(chunk)
                    if total > job.max_request_bytes:
                        raise SidecarError("REQUEST_TOO_LARGE", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                    digest.update(chunk)
                    output.write(chunk)
            os.replace(part, target)
            artifact = Artifact(target, total, digest.hexdigest(), ARTIFACT_SPECS[name][1])
            with self._lock:
                if sum(item.byte_size for item in job.artifacts.values()) - (job.artifacts.get(name).byte_size if name in job.artifacts else 0) + total > job.max_total_bytes:
                    target.unlink(missing_ok=True)
                    raise SidecarError("TOTAL_TOO_LARGE", HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
                job.artifacts[name] = artifact
            return artifact
        except Exception:
            part.unlink(missing_ok=True)
            raise
        finally:
            with self._lock:
                job.uploading.discard(name)

    def complete(self, job_id: str, token: str, payload: object) -> dict[str, Artifact]:
        job = self._job(job_id, token)
        if not isinstance(payload, dict) or set(payload) != {"artifacts"} or not isinstance(payload["artifacts"], dict):
            raise SidecarError("INVALID_MANIFEST")
        declared = payload["artifacts"]
        if set(declared) != set(job.artifacts):
            raise SidecarError("ARTIFACT_SET_MISMATCH")
        for name, metadata in declared.items():
            artifact = job.artifacts[name]
            if not isinstance(metadata, dict) or metadata.get("byteSize") != artifact.byte_size or metadata.get("sha256") != artifact.sha256:
                raise SidecarError("ARTIFACT_INTEGRITY_MISMATCH")
        return dict(job.artifacts)


class _ChunkedBody:
    """Decode HTTP/1.1 chunked request bodies without buffering them."""
    def __init__(self, source: BinaryIO) -> None:
        self.source = source
        self.remaining = 0
        self.done = False

    def read(self, maximum: int = -1) -> bytes:
        if self.done: return b""
        if self.remaining == 0:
            line = self.source.readline(8192)
            try: self.remaining = int(line.split(b";", 1)[0].strip(), 16)
            except ValueError as exc: raise SidecarError("INVALID_CHUNKED_BODY") from exc
            if self.remaining == 0:
                # Consume optional trailers through the terminating empty line.
                while self.source.readline(8192) not in {b"\r\n", b"\n", b""}: pass
                self.done = True; return b""
        size = self.remaining if maximum < 0 else min(self.remaining, maximum)
        data = self.source.read(size)
        if len(data) != size: raise SidecarError("INTERRUPTED_UPLOAD")
        self.remaining -= size
        if self.remaining == 0 and self.source.read(2) != b"\r\n": raise SidecarError("INVALID_CHUNKED_BODY")
        return data


class _Handler(BaseHTTPRequestHandler):
    server: "SidecarHttpServer"
    protocol_version = "HTTP/1.1"

    def log_message(self, _format: str, *_args: object) -> None:
        return  # capability tokens must never reach logs

    def _guard(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0].lower()
        if host not in self.server.allowed_hosts:
            self._error(SidecarError("UNEXPECTED_HOST", HTTPStatus.MISDIRECTED_REQUEST)); return False
        origin = self.headers.get("Origin")
        if origin is not None and origin not in self.server.allowed_origins:
            self._error(SidecarError("UNEXPECTED_ORIGIN", HTTPStatus.FORBIDDEN)); return False
        return True

    def _route(self) -> list[str] | None:
        parts = self.path.split("?", 1)[0].split("/")
        if len(parts) < 4 or parts[:3] != ["", "v1", "jobs"]:
            return None
        return parts[3:]

    def _token(self) -> str:
        prefix = "Bearer "
        value = self.headers.get("Authorization", "")
        if not value.startswith(prefix) or not value[len(prefix):]:
            raise SidecarError("UNAUTHORIZED", HTTPStatus.UNAUTHORIZED)
        return value[len(prefix):]

    def _json(self, status: HTTPStatus, value: object) -> None:
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status); self._cors(); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def _error(self, error: SidecarError) -> None:
        self._json(error.status, {"error": error.code})

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in self.server.allowed_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def do_OPTIONS(self) -> None:
        if not self._guard(): return
        origin = self.headers.get("Origin")
        if origin not in self.server.allowed_origins:
            self._error(SidecarError("UNEXPECTED_ORIGIN", HTTPStatus.FORBIDDEN)); return
        self.send_response(HTTPStatus.NO_CONTENT); self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        if self.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600"); self.end_headers()

    def do_GET(self) -> None:
        if not self._guard(): return
        try:
            route = self._route()
            if not route or len(route) != 3 or route[1] != "inputs": raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
            path, mime = self.server.sidecar.input(route[0], self._token(), route[2])
            self.send_response(HTTPStatus.OK); self._cors(); self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(path.stat().st_size)); self.end_headers()
            with path.open("rb") as source: shutil.copyfileobj(source, self.wfile, CHUNK_BYTES)
        except SidecarError as error: self._error(error)

    def do_PUT(self) -> None:
        if not self._guard(): return
        try:
            route = self._route()
            if not route or len(route) != 3 or route[1] != "artifacts": raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
            try: length = int(self.headers.get("Content-Length", ""))
            except (TypeError, ValueError): length = None
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                source: BinaryIO = _ChunkedBody(self.rfile)
                length = None
            elif length is None:
                raise SidecarError("LENGTH_REQUIRED", HTTPStatus.LENGTH_REQUIRED)
            else:
                source = self.rfile
            item = self.server.sidecar.put_artifact(route[0], self._token(), route[2], self.headers.get("Content-Type", ""), source, length)
            self._json(HTTPStatus.CREATED, {"byteSize": item.byte_size, "sha256": item.sha256})
        except SidecarError as error: self._error(error)

    def do_POST(self) -> None:
        if not self._guard(): return
        try:
            route = self._route()
            if not route or len(route) != 2 or route[1] != "complete": raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
            length = int(self.headers.get("Content-Length", "-1"))
            if length < 0 or length > 65536: raise SidecarError("INVALID_MANIFEST")
            try: payload = json.loads(self.rfile.read(length))
            except json.JSONDecodeError as exc: raise SidecarError("INVALID_MANIFEST") from exc
            artifacts = self.server.sidecar.complete(route[0], self._token(), payload)
            self._json(HTTPStatus.OK, {"artifacts": {name: {"byteSize": item.byte_size, "sha256": item.sha256} for name, item in artifacts.items()}})
        except SidecarError as error: self._error(error)

    def do_DELETE(self) -> None:
        if not self._guard(): return
        try:
            route = self._route()
            if not route or len(route) != 1: raise SidecarError("NOT_FOUND", HTTPStatus.NOT_FOUND)
            self.server.sidecar._job(route[0], self._token())
            self.server.sidecar.delete_job(route[0]); self.send_response(HTTPStatus.NO_CONTENT); self.end_headers()
        except SidecarError as error: self._error(error)


class SidecarHttpServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, sidecar: ProductionSidecar, host: str = "127.0.0.1", port: int = 0,
                 *, allow_private_bind: bool = False, allowed_origins: set[str] | None = None,
                 allowed_hosts: set[str] | None = None) -> None:
        if host not in {"127.0.0.1", "::1", "localhost"} and not allow_private_bind:
            raise ValueError("non-loopback bind requires allow_private_bind")
        self.sidecar = sidecar
        defaults = {host.lower(), "localhost", "127.0.0.1", "::1"}
        configured = set() if allowed_hosts is None else {value.lower() for value in allowed_hosts}
        if not all(value and ":" not in value and "/" not in value for value in configured):
            raise ValueError("allowed_hosts must contain bare host names")
        self.allowed_hosts = defaults | configured
        self.allowed_origins = set() if allowed_origins is None else set(allowed_origins)
        super().__init__((host, port), _Handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="LED Mapper production sidecar")
    parser.add_argument("--host", default="127.0.0.1"); parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--allow-private-bind", action="store_true")
    args = parser.parse_args()
    service = ProductionSidecar()
    server = SidecarHttpServer(service, args.host, args.port, allow_private_bind=args.allow_private_bind)
    try:
        print(f"production-sidecar listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
        server.serve_forever()
    finally:
        server.server_close(); service.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
