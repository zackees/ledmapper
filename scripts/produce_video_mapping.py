#!/usr/bin/env python3
"""Produce deterministic LED Mapper artifacts from a /produce job URL."""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import http.client
import ipaddress
import json
import os
import re
import socket
import ssl
import stat
import sys
import tempfile
import time
import urllib.parse
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable

MAX_JOB_URL_LENGTH = 8192
MAX_REDIRECTS = 5
DOWNLOAD_TIMEOUT_SECONDS = 60.0
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
MAX_ARCHIVE_ENTRIES = 32
MAX_ENTRY_BYTES = 1536 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200.0
POLL_INTERVAL_SECONDS = 0.2
PRODUCTION_API_VERSION = 1
VIDEO_INPUT_SELECTOR = '#production-video-input'
SCREENMAP_INPUT_SELECTOR = '#production-screenmap-input'
ALLOWED_COMPRESSIONS = {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED}
_DRIVE_RE = re.compile(r"^[A-Za-z]:")


class ProducerError(Exception):
    """Expected producer failure with a stable category and exit code."""

    def __init__(self, code: str, message: str, exit_code: int = 1) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = exit_code


@dataclass(frozen=True)
class JobRequest:
    url: str
    input_url: str
    output: str


@dataclass(frozen=True)
class ExtractedInput:
    video_path: Path
    screenmap_path: Path
    archive_sha256: str
    archive_size: int


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def redact_url(url: str) -> str:
    """Return a safe URL for logs, omitting credentials, query, and fragment."""
    try:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname or "<invalid>"
        if parsed.port is not None:
            host = f"{host}:{parsed.port}"
        return urllib.parse.urlunsplit((parsed.scheme, host, parsed.path, "", ""))
    except (TypeError, ValueError):
        return "<invalid-url>"


def _single_query_value(query: str, key: str, *, required: bool = True) -> str | None:
    pairs = urllib.parse.parse_qsl(query, keep_blank_values=True, strict_parsing=False)
    values = [value for name, value in pairs if name == key]
    if len(values) > 1:
        raise ProducerError("INVALID_JOB_URL", f"Duplicate query parameter: {key}", 2)
    if not values or not values[0]:
        if required:
            raise ProducerError("INVALID_JOB_URL", f"Missing query parameter: {key}", 2)
        return None
    return values[0]


def parse_job_url(url: str) -> JobRequest:
    if not isinstance(url, str) or not url or len(url) > MAX_JOB_URL_LENGTH:
        raise ProducerError("INVALID_JOB_URL", "Job URL is empty or too long", 2)
    try:
        parsed = urllib.parse.urlsplit(url)
    except ValueError as exc:
        raise ProducerError("INVALID_JOB_URL", "Job URL is malformed", 2) from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ProducerError("INVALID_JOB_URL", "Job URL must be absolute HTTP(S)", 2)
    if parsed.username is not None or parsed.password is not None:
        raise ProducerError("INVALID_JOB_URL", "Job URL credentials are not allowed", 2)
    if parsed.fragment:
        raise ProducerError("INVALID_JOB_URL", "Job URL fragments are not allowed", 2)
    version = _single_query_value(parsed.query, "v")
    if version != "1":
        raise ProducerError("UNSUPPORTED_VERSION", "Only production contract v=1 is supported", 2)
    input_url = _single_query_value(parsed.query, "input")
    assert input_url is not None
    validate_http_url(input_url, resolve=False)
    output = _single_query_value(parsed.query, "output")
    if output not in {"fled", "mp4", "both"}:
        raise ProducerError("INVALID_JOB_URL", "output must be fled, mp4, or both", 2)
    return JobRequest(url=url, input_url=input_url, output=output)


def _is_forbidden_address(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    return not ip.is_global


def validate_http_url(
    url: str,
    *,
    allow_private_network: bool = False,
    resolve: bool = True,
    resolver: Callable[..., Iterable[Any]] = socket.getaddrinfo,
) -> urllib.parse.SplitResult:
    try:
        parsed = urllib.parse.urlsplit(url)
        port = parsed.port
    except ValueError as exc:
        raise ProducerError("INVALID_INPUT_URL", "Input URL is malformed", 2) from exc
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ProducerError("INVALID_INPUT_URL", "Input URL must be absolute HTTP(S)", 2)
    try:
        url.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ProducerError("INVALID_INPUT_URL", "Input URL must use ASCII or percent-encoding", 2) from exc
    if port == 0:
        raise ProducerError("INVALID_INPUT_URL", "Input URL port must be between 1 and 65535", 2)
    if parsed.username is not None or parsed.password is not None:
        raise ProducerError("INVALID_INPUT_URL", "Input URL credentials are not allowed", 2)
    if parsed.fragment:
        raise ProducerError("INVALID_INPUT_URL", "Input URL fragments are not allowed", 2)
    if allow_private_network or not resolve:
        return parsed
    try:
        records = resolver(parsed.hostname, port or (443 if parsed.scheme == "https" else 80),
                           type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ProducerError("NETWORK_POLICY", "Input host could not be resolved", 3) from exc
    addresses = {record[4][0] for record in records}
    if not addresses:
        raise ProducerError("NETWORK_POLICY", "Input host returned no addresses", 3)
    if any(_is_forbidden_address(address) for address in addresses):
        raise ProducerError("NETWORK_POLICY", "Input host resolves to a non-public address", 3)
    return parsed


def _resolve_allowed_addresses(
    parsed: urllib.parse.SplitResult,
    *,
    allow_private_network: bool,
    resolver: Callable[..., Iterable[Any]] = socket.getaddrinfo,
) -> list[str]:
    port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
    try:
        records = resolver(parsed.hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ProducerError("NETWORK_POLICY", "Input host could not be resolved", 3) from exc
    addresses = list(dict.fromkeys(record[4][0] for record in records))
    if not addresses:
        raise ProducerError("NETWORK_POLICY", "Input host returned no addresses", 3)
    if not allow_private_network and any(_is_forbidden_address(address) for address in addresses):
        raise ProducerError("NETWORK_POLICY", "Input host resolves to a non-public address", 3)
    return addresses


def _open_pinned_response(
    parsed: urllib.parse.SplitResult,
    address: str,
    *,
    timeout: float,
) -> http.client.HTTPResponse:
    port = parsed.port if parsed.port is not None else (443 if parsed.scheme == "https" else 80)
    hostname = parsed.hostname or ""
    host_header = f"[{hostname}]" if ":" in hostname else hostname
    if parsed.port is not None:
        host_header = f"{host_header}:{parsed.port}"
    target = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
    sock = socket.create_connection((address, port), timeout=timeout)
    try:
        if parsed.scheme == "https":
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=parsed.hostname)
        request = (
            f"GET {target} HTTP/1.1\r\n"
            f"Host: {host_header}\r\n"
            "User-Agent: ledmapper-producer/1\r\n"
            "Accept: application/zip\r\n"
            "Connection: close\r\n\r\n"
        ).encode("ascii")
        sock.sendall(request)
        return http.client.HTTPResponse(sock)
    except Exception:
        sock.close()
        raise


def download_archive(
    url: str,
    destination: Path,
    *,
    allow_private_network: bool = False,
    max_bytes: int = MAX_DOWNLOAD_BYTES,
    timeout: float = DOWNLOAD_TIMEOUT_SECONDS,
    max_redirects: int = MAX_REDIRECTS,
) -> tuple[int, str, str]:
    current = url
    for redirect_count in range(max_redirects + 1):
        parsed = validate_http_url(current, allow_private_network=allow_private_network, resolve=False)
        addresses = _resolve_allowed_addresses(parsed, allow_private_network=allow_private_network)
        response = None
        last_error: Exception | None = None
        for address in addresses:
            try:
                response = _open_pinned_response(parsed, address, timeout=timeout)
                response.begin()
                break
            except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
                last_error = exc
        if response is None:
            raise ProducerError("DOWNLOAD_FAILED", "Input download failed", 3) from last_error

        with contextlib.closing(response):
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ProducerError("DOWNLOAD_FAILED", "Redirect omitted Location", 3)
                if redirect_count >= max_redirects:
                    raise ProducerError("DOWNLOAD_FAILED", "Too many input redirects", 3)
                current = urllib.parse.urljoin(current, location)
                continue
            if response.status < 200 or response.status >= 300:
                raise ProducerError("DOWNLOAD_FAILED", f"Input server returned HTTP {response.status}", 3)
            content_length = response.getheader("Content-Length")
            if content_length:
                try:
                    declared_size = int(content_length)
                except ValueError:
                    declared_size = -1
                if declared_size > max_bytes:
                    raise ProducerError("DOWNLOAD_TOO_LARGE", "Input archive exceeds size limit", 3)
            digest = hashlib.sha256()
            total = 0
            try:
                with destination.open("wb") as output:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        total += len(chunk)
                        if total > max_bytes:
                            raise ProducerError("DOWNLOAD_TOO_LARGE", "Input archive exceeds size limit", 3)
                        digest.update(chunk)
                        output.write(chunk)
            except ProducerError:
                destination.unlink(missing_ok=True)
                raise
            except (OSError, TimeoutError, http.client.HTTPException) as exc:
                destination.unlink(missing_ok=True)
                raise ProducerError("DOWNLOAD_FAILED", "Input download was interrupted", 3) from exc
            return total, digest.hexdigest(), current
    raise ProducerError("DOWNLOAD_FAILED", "Too many input redirects", 3)


def _safe_member_path(name: str) -> PurePosixPath:
    if not name or "\x00" in name or "\\" in name:
        raise ProducerError("UNSAFE_ARCHIVE", "Archive contains an unsafe path", 4)
    if name.startswith(("/", "//")) or _DRIVE_RE.match(name):
        raise ProducerError("UNSAFE_ARCHIVE", "Archive contains an absolute path", 4)
    path = PurePosixPath(name)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise ProducerError("UNSAFE_ARCHIVE", "Archive contains path traversal", 4)
    return path


def inspect_and_extract_archive(
    archive_path: Path,
    extract_dir: Path,
    *,
    max_entries: int = MAX_ARCHIVE_ENTRIES,
    max_entry_bytes: int = MAX_ENTRY_BYTES,
    max_total_bytes: int = MAX_UNCOMPRESSED_BYTES,
    max_ratio: float = MAX_COMPRESSION_RATIO,
) -> tuple[Path, Path]:
    try:
        archive = zipfile.ZipFile(archive_path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ProducerError("INVALID_ARCHIVE", "Input is not a valid ZIP archive", 4) from exc

    with archive:
        infos = archive.infolist()
        if len(infos) > max_entries:
            raise ProducerError("ARCHIVE_LIMIT", "Archive has too many entries", 4)
        seen: set[str] = set()
        files: list[tuple[zipfile.ZipInfo, PurePosixPath]] = []
        total_size = 0
        for info in infos:
            path = _safe_member_path(info.filename.rstrip("/") if info.is_dir() else info.filename)
            key = path.as_posix().casefold()
            if key in seen:
                raise ProducerError("INVALID_ARCHIVE", "Archive contains duplicate normalized names", 4)
            seen.add(key)
            mode = (info.external_attr >> 16) & 0xFFFF
            file_type = stat.S_IFMT(mode)
            if file_type not in {0, stat.S_IFREG, stat.S_IFDIR}:
                raise ProducerError("UNSAFE_ARCHIVE", "Archive contains a link or device entry", 4)
            if info.flag_bits & 0x1:
                raise ProducerError("UNSAFE_ARCHIVE", "Encrypted ZIP entries are not supported", 4)
            if info.compress_type not in ALLOWED_COMPRESSIONS:
                raise ProducerError("INVALID_ARCHIVE", "ZIP compression method is not supported", 4)
            if info.is_dir():
                continue
            if info.file_size > max_entry_bytes:
                raise ProducerError("ARCHIVE_LIMIT", "Archive entry exceeds size limit", 4)
            total_size += info.file_size
            if total_size > max_total_bytes:
                raise ProducerError("ARCHIVE_LIMIT", "Archive expands beyond size limit", 4)
            ratio = info.file_size / max(info.compress_size, 1)
            if ratio > max_ratio:
                raise ProducerError("ARCHIVE_LIMIT", "Archive compression ratio exceeds limit", 4)
            files.append((info, path))

        if len(files) != 2:
            raise ProducerError("INVALID_ARCHIVE", "Archive must contain only one MP4 and screenmap.json", 4)
        parents = {path.parent.as_posix() for _, path in files}
        if len(parents) != 1 or next(iter(parents)) not in {".", files[0][1].parts[0]}:
            raise ProducerError("INVALID_ARCHIVE", "Inputs must share the archive root or one enclosing directory", 4)
        parent = next(iter(parents))
        if parent != "." and (len(PurePosixPath(parent).parts) != 1 or any(len(path.parts) != 2 for _, path in files)):
            raise ProducerError("INVALID_ARCHIVE", "Only one enclosing directory is allowed", 4)
        videos = [(info, path) for info, path in files if path.suffix.lower() == ".mp4"]
        maps = [(info, path) for info, path in files if path.name == "screenmap.json"]
        if len(videos) != 1 or len(maps) != 1:
            raise ProducerError("INVALID_ARCHIVE", "Archive requires one MP4 and case-sensitive screenmap.json", 4)

        extract_dir.mkdir(parents=True, exist_ok=True)
        extracted: dict[str, Path] = {}
        for info, path in files:
            destination = extract_dir.joinpath(*path.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            written = 0
            try:
                with archive.open(info, "r") as source, destination.open("xb") as output:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > info.file_size or written > max_entry_bytes:
                            raise ProducerError("ARCHIVE_LIMIT", "Extracted entry exceeds declared size", 4)
                        output.write(chunk)
            except Exception:
                destination.unlink(missing_ok=True)
                raise
            if written != info.file_size:
                raise ProducerError("INVALID_ARCHIVE", "Extracted entry size does not match ZIP metadata", 4)
            extracted[path.as_posix()] = destination
        return extracted[videos[0][1].as_posix()], extracted[maps[0][1].as_posix()]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _expected_extensions(output: str) -> tuple[str, ...]:
    return {"fled": (".fled",), "mp4": (".mp4",), "both": (".fled", ".mp4")}[output]


def launch_production_browser(playwright: Any, *, headed: bool) -> Any:
    """Prefer installed Chrome: bundled Chromium commonly lacks H.264 decode."""
    options = {"headless": not headed}
    try:
        return playwright.chromium.launch(channel="chrome", **options)
    except Exception:
        return playwright.chromium.launch(**options)


def run_browser_job(job: JobRequest, extracted: ExtractedInput, download_dir: Path,
                    *, timeout_seconds: float = 3600.0, headed: bool = False) -> tuple[dict[str, Any], list[Path]]:
    """Drive the production API. Playwright is intentionally imported lazily."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as exc:
        raise ProducerError(
            "PLAYWRIGHT_UNAVAILABLE",
            "Install scripts/requirements-production.txt and run: python -m playwright install chromium",
            5,
        ) from exc

    expected = _expected_extensions(job.output)
    download_dir.mkdir(parents=True, exist_ok=True)
    captured: list[Any] = []
    with sync_playwright() as playwright:
        browser = launch_production_browser(playwright, headed=headed)
        try:
            page = browser.new_page(accept_downloads=True)
            page.on("download", lambda download: captured.append(download))
            page.goto(job.url, wait_until="domcontentloaded", timeout=60_000)
            page.wait_for_function(
                "() => window.__lmProduction?.apiVersion === 1",
                timeout=60_000,
            )
            initial = page.evaluate("() => window.__lmProduction.getState()")
            config = initial.get("config") or {}
            if config.get("input") != job.input_url:
                raise ProducerError("PROVENANCE_MISMATCH", "Browser normalized input does not match the job", 6)
            if config.get("output") != job.output:
                raise ProducerError("CONTRACT_MISMATCH", "Browser normalized output does not match the job", 6)
            page.set_input_files(VIDEO_INPUT_SELECTOR, str(extracted.video_path))
            page.set_input_files(SCREENMAP_INPUT_SELECTOR, str(extracted.screenmap_path))
            page.evaluate(
                "([url]) => window.__lmProduction.provideInputFromElements({ sourceArchiveUrl: url })",
                [job.input_url],
            )
            page.evaluate("() => { void window.__lmProduction.start(); }")
            deadline = time.monotonic() + timeout_seconds
            state = initial
            while time.monotonic() < deadline:
                state = page.evaluate("() => window.__lmProduction.getState()")
                phase = state.get("phase")
                if phase == "completed":
                    break
                if phase in {"failed", "cancelled"}:
                    error = state.get("error") or {}
                    raise ProducerError("BROWSER_JOB_FAILED", str(error.get("message") or phase), 6)
                page.wait_for_timeout(int(POLL_INTERVAL_SECONDS * 1000))
            else:
                with contextlib.suppress(Exception):
                    page.evaluate("() => window.__lmProduction.cancel()")
                raise ProducerError("BROWSER_TIMEOUT", "Production job timed out", 6)

            wait_deadline = time.monotonic() + 30.0
            while len(captured) < len(expected) and time.monotonic() < wait_deadline:
                page.wait_for_timeout(100)
            if len(captured) != len(expected):
                raise ProducerError("DOWNLOAD_MISMATCH", "Browser emitted an unexpected number of artifacts", 6)

            saved: list[Path] = []
            seen_extensions: set[str] = set()
            for download in captured:
                filename = Path(download.suggested_filename).name
                extension = Path(filename).suffix.lower()
                if filename != download.suggested_filename or extension not in expected or extension in seen_extensions:
                    raise ProducerError("DOWNLOAD_MISMATCH", "Browser emitted an invalid artifact name", 6)
                seen_extensions.add(extension)
                destination = download_dir / filename
                download.save_as(str(destination))
                failure = download.failure()
                if failure or not destination.is_file() or destination.stat().st_size == 0:
                    raise ProducerError("DOWNLOAD_FAILED", "Browser artifact download failed", 6)
                saved.append(destination)
            if seen_extensions != set(expected):
                raise ProducerError("DOWNLOAD_MISMATCH", "Browser artifacts do not match requested output", 6)
            return state, sorted(saved, key=lambda path: path.name)
        finally:
            browser.close()


def build_manifest(job: JobRequest, extracted: ExtractedInput, state: dict[str, Any],
                   artifacts: list[Path], *, started_at: str, completed_at: str) -> dict[str, Any]:
    state_artifacts = state.get("artifacts") or []
    by_name = {item.get("filename"): item for item in state_artifacts if isinstance(item, dict)}
    artifact_items = []
    for path in sorted(artifacts, key=lambda item: item.name):
        browser_metadata = dict(by_name.get(path.name) or {})
        browser_metadata.update({
            "filename": path.name,
            "byteSize": path.stat().st_size,
            "sha256": sha256_file(path),
        })
        artifact_items.append(browser_metadata)
    input_metadata = dict(state.get("inputMetadata") or {})
    input_metadata.update({
        "sourceArchiveUrl": redact_url(job.input_url),
        "archiveByteSize": extracted.archive_size,
        "archiveSha256": extracted.archive_sha256,
        "videoFilename": extracted.video_path.name,
        "screenmapFilename": extracted.screenmap_path.name,
    })
    config = dict(state.get("config") or {})
    if isinstance(config.get("input"), str):
        config["input"] = redact_url(config["input"])
    return {
        "manifestVersion": 1,
        "contractVersion": 1,
        "config": config,
        "input": input_metadata,
        "app": state.get("app") or state.get("appMetadata") or {},
        "render": {
            "frameCount": state.get("frameCount") or (state.get("progress") or {}).get("totalFrames"),
            "fps": state.get("fps") or (state.get("progress") or {}).get("fps"),
        },
        "artifacts": artifact_items,
        "timestamps": {"startedAt": started_at, "completedAt": completed_at},
    }


def create_output_zip(destination: Path, manifest: dict[str, Any], artifacts: list[Path]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise ProducerError("OUTPUT_EXISTS", "Output package already exists", 7)
    temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
    try:
        try:
            with temporary.open("xb") as raw_output:
                with zipfile.ZipFile(raw_output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
                    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
                    archive.writestr("manifest.json", manifest_bytes, compress_type=zipfile.ZIP_DEFLATED, compresslevel=1)
                    for artifact in sorted(artifacts, key=lambda path: path.name):
                        archive.write(artifact, artifact.name, compress_type=zipfile.ZIP_DEFLATED, compresslevel=1)
            os.link(temporary, destination)
        except FileExistsError as exc:
            raise ProducerError("OUTPUT_EXISTS", "Output package already exists", 7) from exc
    finally:
        temporary.unlink(missing_ok=True)


def _source_stem(video_path: Path) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", video_path.stem).strip(".-")
    return stem or "video"


def produce(job: JobRequest, output_dir: Path, *, allow_private_network: bool,
            headed: bool, timeout_seconds: float) -> Path:
    started_at = utc_now()
    output_dir = output_dir.resolve()
    if output_dir.exists() and not output_dir.is_dir():
        raise ProducerError("INVALID_OUTPUT_DIR", "Output path is not a directory", 2)
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ledmapper-producer-") as temporary_name:
        temporary = Path(temporary_name)
        archive_path = temporary / "input.zip"
        archive_size, archive_hash, _ = download_archive(
            job.input_url,
            archive_path,
            allow_private_network=allow_private_network,
        )
        video_path, screenmap_path = inspect_and_extract_archive(archive_path, temporary / "input")
        extracted = ExtractedInput(video_path, screenmap_path, archive_hash, archive_size)
        state, artifacts = run_browser_job(
            job,
            extracted,
            temporary / "artifacts",
            timeout_seconds=timeout_seconds,
            headed=headed,
        )
        completed_at = utc_now()
        manifest = build_manifest(
            job, extracted, state, artifacts, started_at=started_at, completed_at=completed_at
        )
        destination = output_dir / f"{_source_stem(video_path)}-ledmapper-v1.zip"
        create_output_zip(destination, manifest, artifacts)
        return destination


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("job_url", help="Full LED Mapper /produce/?... job URL")
    parser.add_argument("--output-dir", required=True, type=Path, help="Directory for the final ZIP")
    parser.add_argument(
        "--allow-private-network",
        action="store_true",
        help="Allow loopback/private input URLs for trusted local workflows",
    )
    parser.add_argument("--headed", action="store_true", help="Show the Chromium window")
    parser.add_argument("--timeout", type=float, default=3600.0, help="Browser job timeout in seconds")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if not (0 < args.timeout <= 24 * 60 * 60):
            raise ProducerError("INVALID_ARGUMENT", "--timeout must be between 0 and 86400", 2)
        job = parse_job_url(args.job_url)
        destination = produce(
            job,
            args.output_dir,
            allow_private_network=args.allow_private_network,
            headed=args.headed,
            timeout_seconds=args.timeout,
        )
    except ProducerError as exc:
        print(json.dumps({"error": {"code": exc.code, "message": exc.message}}), file=sys.stderr)
        return exc.exit_code
    except KeyboardInterrupt:
        print(json.dumps({"error": {"code": "CANCELLED", "message": "Cancelled"}}), file=sys.stderr)
        return 130
    except Exception:
        print(json.dumps({"error": {"code": "INTERNAL_ERROR", "message": "Unexpected producer failure"}}), file=sys.stderr)
        return 1
    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
