from __future__ import annotations

import hashlib
import http.client
import importlib.util
import json
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[2] / "scripts" / "production_sidecar.py"
SPEC = importlib.util.spec_from_file_location("production_sidecar", SCRIPT)
assert SPEC and SPEC.loader
sidecar = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sidecar
SPEC.loader.exec_module(sidecar)


class SidecarTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.video = self.root / "source.mp4"; self.video.write_bytes(b"video")
        self.map = self.root / "screenmap.json"; self.map.write_text("{}")
        self.service = sidecar.ProductionSidecar(self.root / "jobs", ttl_seconds=0.05, max_request_bytes=32, max_total_bytes=40)
        self.token = self.service.register_job("job-1", video=self.video, screenmap=self.map)

    def tearDown(self) -> None:
        self.service.close(); self.temp.cleanup()

    def test_capability_and_identifier_only_inputs(self) -> None:
        path, mime = self.service.input("job-1", self.token, "video")
        self.assertEqual(path.read_bytes(), b"video"); self.assertEqual(mime, "video/mp4")
        with self.assertRaises(sidecar.SidecarError): self.service.input("job-1", "wrong", "video")
        with self.assertRaises(sidecar.SidecarError): self.service.input("../job-1", self.token, "../../secret")
        self.assertGreaterEqual(len(self.token), 40)

    def test_stream_integrity_limit_and_cleanup(self) -> None:
        import io
        item = self.service.put_artifact("job-1", self.token, "fled", "application/vnd.fastled.video", io.BytesIO(b"abc"), 3)
        self.assertEqual(item.sha256, hashlib.sha256(b"abc").hexdigest())
        with self.assertRaisesRegex(sidecar.SidecarError, "ARTIFACT_INTEGRITY_MISMATCH"):
            self.service.complete("job-1", self.token, {"artifacts": {"fled": {"byteSize": 3, "sha256": "bad"}}})
        with self.assertRaisesRegex(sidecar.SidecarError, "INTERRUPTED_UPLOAD"):
            self.service.put_artifact("job-1", self.token, "mp4", "video/mp4", io.BytesIO(b"x"), 2)
        self.assertFalse((self.service.jobs["job-1"].directory / ".mp4.part").exists())
        with self.assertRaisesRegex(sidecar.SidecarError, "REQUEST_TOO_LARGE"):
            self.service.put_artifact("job-1", self.token, "mp4", "video/mp4", io.BytesIO(b"x" * 33), 33)

    def test_jobs_are_isolated_and_upload_slots_are_bounded(self) -> None:
        import io
        other_token = self.service.register_job("job-2", video=self.video, screenmap=self.map)
        self.service.jobs["job-1"].uploading.update({"fled", "mp4"})
        with self.assertRaisesRegex(sidecar.SidecarError, "UPLOAD_BUSY"):
            self.service.put_artifact("job-1", self.token, "mp4", "video/mp4", io.BytesIO(b"x"), 1)
        item = self.service.put_artifact("job-2", other_token, "mp4", "video/mp4", io.BytesIO(b"other"), 5)
        self.assertEqual(item.path.parent, self.service.jobs["job-2"].directory)
        self.assertFalse((self.service.jobs["job-1"].directory / "result.mp4").exists())

    def test_expiry_and_crash_remnant_cleanup(self) -> None:
        directory = self.service.jobs["job-1"].directory
        time.sleep(0.06); self.service.sweep_expired()
        self.assertNotIn("job-1", self.service.jobs); self.assertFalse(directory.exists())
        remnant = self.service.root / "crashed"; remnant.mkdir(); (remnant / ".upload.part").write_bytes(b"x")
        self.service.clean_stale(); self.assertFalse(remnant.exists())


class HttpProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(); root = Path(self.temp.name)
        video = root / "source.mp4"; video.write_bytes(b"video")
        screenmap = root / "screenmap.json"; screenmap.write_text("{}")
        self.service = sidecar.ProductionSidecar(root / "jobs")
        self.token = self.service.register_job("alpha", video=video, screenmap=screenmap)
        self.server = sidecar.SidecarHttpServer(self.service, allowed_origins={"https://app.example"})
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True); self.thread.start()

    def tearDown(self) -> None:
        self.server.shutdown(); self.server.server_close(); self.thread.join(); self.service.close(); self.temp.cleanup()

    def request(self, method: str, path: str, *, headers=None, body=None, encode_chunked=False):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1])
        connection.request(method, path, body=body, headers=headers or {}, encode_chunked=encode_chunked)
        response = connection.getresponse(); data = response.read(); connection.close()
        return response.status, data

    def auth(self, **extra):
        return {"Authorization": "Bearer " + self.token, **extra}

    def test_host_origin_auth_upload_complete_and_delete(self) -> None:
        status, body = self.request("GET", "/v1/jobs/alpha/inputs/video", headers={"Host": "evil.example"})
        self.assertEqual(status, 421); self.assertEqual(json.loads(body)["error"], "UNEXPECTED_HOST")
        status, _ = self.request("GET", "/v1/jobs/alpha/inputs/video", headers=self.auth(Origin="https://evil.example"))
        self.assertEqual(status, 403)
        status, data = self.request("GET", "/v1/jobs/alpha/inputs/video", headers=self.auth(Origin="https://app.example"))
        self.assertEqual(status, 200); self.assertEqual(data, b"video")
        payload = b"fled-data"; digest = hashlib.sha256(payload).hexdigest()
        status, _ = self.request("PUT", "/v1/jobs/alpha/artifacts/fled", headers=self.auth(**{"Content-Type": "application/vnd.fastled.video", "Content-Length": str(len(payload))}), body=payload)
        self.assertEqual(status, 201)
        manifest = json.dumps({"artifacts": {"fled": {"byteSize": len(payload), "sha256": digest}}})
        status, _ = self.request("POST", "/v1/jobs/alpha/complete", headers=self.auth(**{"Content-Length": str(len(manifest))}), body=manifest)
        self.assertEqual(status, 200)
        status, _ = self.request("DELETE", "/v1/jobs/alpha", headers=self.auth())
        self.assertEqual(status, 204); self.assertNotIn("alpha", self.service.jobs)

    def test_chunked_upload_is_bounded_and_streamed(self) -> None:
        payload = b"chunked-fled"
        status, response = self.request(
            "PUT", "/v1/jobs/alpha/artifacts/fled",
            headers=self.auth(**{"Content-Type": "application/vnd.fastled.video", "Transfer-Encoding": "chunked"}),
            body=[payload[:4], payload[4:]], encode_chunked=True,
        )
        self.assertEqual(status, 201)
        self.assertEqual(json.loads(response)["byteSize"], len(payload))

    def test_allowed_origin_receives_narrow_cors_preflight(self) -> None:
        status, _ = self.request("OPTIONS", "/v1/jobs/alpha/inputs/video", headers={
            "Origin": "https://app.example", "Access-Control-Request-Private-Network": "true",
        })
        self.assertEqual(status, 204)

    def test_private_bind_can_allow_a_named_container_route(self) -> None:
        server = sidecar.SidecarHttpServer(
            self.service, host="0.0.0.0", allow_private_bind=True,
            allowed_hosts={"host.docker.internal"},
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1])
            connection.request("GET", "/v1/jobs/alpha/inputs/video", headers=self.auth(Host="host.docker.internal"))
            response = connection.getresponse()
            self.assertEqual(response.status, 200); response.read()
            connection.close()
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == "__main__":
    unittest.main()
