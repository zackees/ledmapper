#!/usr/bin/env python3
"""Exercise direct H.264 MP4 production through the public CLI surface."""

from __future__ import annotations

import contextlib
import http.server
import subprocess
import sys
import tempfile
import threading
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).parents[1]
VIDEO = ROOT / "tests" / "fixtures" / "test-video.mp4"
SCREENMAP = ROOT / "tests" / "fixtures" / "test-screenmap.json"
PRODUCER = ROOT / "scripts" / "produce_video_mapping.py"


def start_app() -> tuple[subprocess.Popen[str], str]:
    process = subprocess.Popen(
        ["npm", "run", "dev:agent"], cwd=ROOT, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True,
    )
    assert process.stdout is not None
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        line = process.stdout.readline()
        if "DEV-SERVER-READY " in line:
            return process, line.strip().split("DEV-SERVER-READY ", 1)[1]
        if process.poll() is not None:
            raise RuntimeError("Application server exited before becoming ready")
    process.kill()
    raise RuntimeError("Application server did not become ready")


def main() -> int:
    if not VIDEO.is_file() or not SCREENMAP.is_file():
        raise RuntimeError("Direct-production fixtures are missing")
    with tempfile.TemporaryDirectory(prefix="ledmapper-direct-mp4-") as temporary_name:
        temporary = Path(temporary_name)
        input_dir = temporary / "input"
        input_dir.mkdir()
        with zipfile.ZipFile(input_dir / "job.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(VIDEO, VIDEO.name)
            archive.write(SCREENMAP, "screenmap.json")

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), lambda *args: http.server.SimpleHTTPRequestHandler(*args, directory=input_dir))
        server_thread = threading.Thread(target=server.serve_forever, daemon=True)
        server_thread.start()
        app = None
        try:
            app, app_url = start_app()
            job_url = f"{app_url}/produce/?v=1&input=http%3A%2F%2F127.0.0.1%3A{server.server_port}%2Fjob.zip&output=mp4&videoMode=mapped-led&outputFps=60"
            result = subprocess.run(
                [sys.executable, str(PRODUCER), job_url, "--output-dir", str(temporary / "output"), "--allow-private-network", "--timeout", "180"],
                cwd=ROOT, text=True, capture_output=True, timeout=240,
            )
            if result.returncode:
                raise RuntimeError(f"Direct MP4 production failed:\n{result.stderr}")
            output = Path(result.stdout.strip())
            with zipfile.ZipFile(output) as archive:
                mp4s = [entry for entry in archive.infolist() if entry.filename.endswith(".mp4")]
                if len(mp4s) != 1 or mp4s[0].file_size == 0:
                    raise RuntimeError("Direct MP4 production did not emit one non-empty MP4 artifact")
            print(output)
        finally:
            server.shutdown()
            server.server_close()
            server_thread.join()
            if app is not None:
                app.terminate()
                with contextlib.suppress(subprocess.TimeoutExpired):
                    app.wait(timeout=10)
                if app.poll() is None:
                    app.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
