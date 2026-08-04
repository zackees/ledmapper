#!/usr/bin/env python3
"""On-demand proof that a separate Chromium container can use a sidecar only."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
import uuid

ROOT = Path(__file__).parents[1]
SIDE_CAR = ROOT / "scripts" / "production_sidecar.py"
TEST_IMAGE = "ledmapper-production-sidecar-isolation:1"
SIDECAR_IMAGE = "ledmapper-production-sidecar-isolation-service:1"
SPEC = importlib.util.spec_from_file_location("production_sidecar", SIDE_CAR)
assert SPEC and SPEC.loader
sidecar = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sidecar
SPEC.loader.exec_module(sidecar)


def run() -> None:
    if shutil.which("docker") is None:
        raise RuntimeError("Docker is required; install Docker Desktop and retry")
    subprocess.run(
        ["docker", "build", "--tag", TEST_IMAGE, "--file", str(ROOT / "scripts" / "production-sidecar-isolation.Dockerfile"), str(ROOT)],
        check=True, timeout=300,
    )
    subprocess.run(["docker", "build", "--tag", SIDECAR_IMAGE, "--file", str(ROOT / "scripts" / "production-sidecar-isolation-service.Dockerfile"), str(ROOT)], check=True, timeout=300)
    suffix = uuid.uuid4().hex[:12]; network = f"ledmapper-sidecar-{suffix}"; container = f"ledmapper-sidecar-{suffix}"
    subprocess.run(["docker", "network", "create", network], check=True)
    try:
        subprocess.run(["docker", "run", "-d", "--rm", "--name", container, "--network", network, "--network-alias", "sidecar", SIDECAR_IMAGE], check=True, capture_output=True)
        token = ""
        for _ in range(30):
            logs = subprocess.run(["docker", "logs", container], text=True, capture_output=True, check=True).stdout
            if logs.strip(): token = json.loads(logs.strip().splitlines()[0])["token"]; break
            import time; time.sleep(0.2)
        if not token: raise RuntimeError("sidecar container did not publish a job capability")
        script = '''const { chromium } = require('/usr/lib/node_modules/playwright-core');
(async () => {
  const browser = await chromium.launch({headless:true, executablePath:'/ms-playwright/chromium-1208/chrome-linux64/chrome', args:['--disable-http2']});
  const page = await browser.newPage();
  page.on('console', (message) => console.error(`browser-console: ${message.type()} ${message.text()}`));
  page.on('requestfailed', (request) => console.error(`browser-request-failed: ${request.url()} ${request.failure()?.errorText}`));
  await page.setContent('<!doctype html><title>isolated browser</title>');
  const result = await page.evaluate(async ({ endpoint, token }) => {
    const headers = { Authorization: `Bearer ${token}` };
    const get = async (name) => {
      const response = await fetch(`${endpoint}/v1/jobs/isolated/inputs/${name}`, {headers});
      return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
    };
    const video = await get('video'); const screenmap = await get('screenmap');
    const payload = new TextEncoder().encode('isolated-browser-fled');
    const upload = await fetch(`${endpoint}/v1/jobs/isolated/artifacts/fled`, {
      method: 'PUT', headers: {...headers, 'Content-Type': 'application/vnd.fastled.video'},
      body: payload,
    });
    const metadata = await upload.json();
    const complete = await fetch(`${endpoint}/v1/jobs/isolated/complete`, {method:'POST', headers: {...headers, 'Content-Type':'application/json'}, body: JSON.stringify({artifacts:{fled:metadata}})});
    return {video, screenmap, upload: upload.status, complete: complete.status, metadata};
  }, { endpoint: 'http://sidecar:8080', token: '__TOKEN__' });
  await browser.close(); console.log(JSON.stringify(result));
})().catch((error) => { console.error(error); process.exit(1); });'''.replace('__TOKEN__', token)
        try:
            completed = subprocess.run(
                ["docker", "run", "--rm", "--network", network, TEST_IMAGE, "node", "-e", script],
                text=True, capture_output=True, check=False, timeout=180,
            )
            if completed.returncode:
                raise RuntimeError(f"container browser failed:\n{completed.stderr.strip()}")
            result = json.loads(completed.stdout.strip().splitlines()[-1])
            expected = hashlib.sha256(b"isolated-browser-fled").hexdigest()
            assert result["video"] == {"status": 200, "bytes": list(b"not-mounted-video")}
            assert result["screenmap"]["status"] == 200
            assert result["upload"] == 201 and result["complete"] == 200
            assert result["metadata"] == {"byteSize": len(b"isolated-browser-fled"), "sha256": expected}
            print("sidecar isolated-browser proof: passed")
        finally:
            subprocess.run(["docker", "rm", "--force", container], capture_output=True)
            subprocess.run(["docker", "network", "rm", network], capture_output=True)
    finally:
        subprocess.run(["docker", "rm", "--force", container], capture_output=True)
        subprocess.run(["docker", "network", "rm", network], capture_output=True)


if __name__ == "__main__":
    run()
