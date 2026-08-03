from __future__ import annotations

import importlib.util
import io
import json
import stat
import sys
import tempfile
import unittest
import urllib.parse
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).parents[2] / "scripts" / "produce_video_mapping.py"
SPEC = importlib.util.spec_from_file_location("produce_video_mapping", SCRIPT)
assert SPEC and SPEC.loader
producer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = producer
SPEC.loader.exec_module(producer)


class ArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def make_zip(self, entries: dict[str, bytes], *, infos=None) -> Path:
        path = self.root / "input.zip"
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            if infos is not None:
                for info, data in infos:
                    archive.writestr(info, data)
            else:
                for name, data in entries.items():
                    archive.writestr(name, data)
        return path

    def extract(self, archive: Path, **kwargs):
        return producer.inspect_and_extract_archive(archive, self.root / "out", **kwargs)

    def test_valid_root_archive(self) -> None:
        video, screenmap = self.extract(self.make_zip({"clip.MP4": b"video", "screenmap.json": b"{}"}))
        self.assertEqual(video.read_bytes(), b"video")
        self.assertEqual(screenmap.name, "screenmap.json")

    def test_valid_single_enclosing_directory(self) -> None:
        video, screenmap = self.extract(self.make_zip({"job/clip.mp4": b"v", "job/screenmap.json": b"{}"}))
        self.assertEqual(video.parent, screenmap.parent)

    def test_missing_duplicate_and_extra_inputs_are_rejected(self) -> None:
        cases = [
            {"clip.mp4": b"v"},
            {"a.mp4": b"v", "b.mp4": b"v", "screenmap.json": b"{}"},
            {"clip.mp4": b"v", "screenmap.json": b"{}", "extra.txt": b"x"},
            {"clip.mp4": b"v", "Screenmap.json": b"{}"},
        ]
        for index, entries in enumerate(cases):
            with self.subTest(index=index), self.assertRaises(producer.ProducerError):
                archive = self.root / f"case-{index}.zip"
                with zipfile.ZipFile(archive, "w") as output:
                    for name, data in entries.items():
                        output.writestr(name, data)
                producer.inspect_and_extract_archive(archive, self.root / f"out-{index}")

    def test_traversal_absolute_drive_and_backslash_paths_are_rejected(self) -> None:
        unsafe = ["../clip.mp4", "/clip.mp4", "C:/clip.mp4", "folder\\clip.mp4"]
        for index, name in enumerate(unsafe):
            with self.subTest(name=name), self.assertRaises(producer.ProducerError):
                archive = self.root / f"unsafe-{index}.zip"
                with zipfile.ZipFile(archive, "w") as output:
                    output.writestr(name, b"v")
                    output.writestr("screenmap.json", b"{}")
                producer.inspect_and_extract_archive(archive, self.root / f"unsafe-out-{index}")

    def test_symlink_is_rejected(self) -> None:
        link = zipfile.ZipInfo("clip.mp4")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        normal = zipfile.ZipInfo("screenmap.json")
        normal.create_system = 3
        normal.external_attr = (stat.S_IFREG | 0o644) << 16
        archive = self.make_zip({}, infos=[(link, b"target"), (normal, b"{}")])
        with self.assertRaisesRegex(producer.ProducerError, "link or device"):
            self.extract(archive)

    def test_duplicate_normalized_names_are_rejected(self) -> None:
        archive = self.root / "duplicates.zip"
        with zipfile.ZipFile(archive, "w") as output:
            output.writestr("clip.mp4", b"v")
            output.writestr("CLIP.MP4", b"v")
            output.writestr("screenmap.json", b"{}")
        with self.assertRaisesRegex(producer.ProducerError, "duplicate normalized"):
            self.extract(archive)

    def test_entry_total_and_ratio_limits(self) -> None:
        archive = self.make_zip({"clip.mp4": b"a" * 1000, "screenmap.json": b"{}"})
        for kwargs in ({"max_entry_bytes": 500}, {"max_total_bytes": 500}, {"max_ratio": 2.0}):
            with self.subTest(kwargs=kwargs), self.assertRaises(producer.ProducerError):
                producer.inspect_and_extract_archive(archive, self.root / ("limit-" + next(iter(kwargs))), **kwargs)


class UrlTests(unittest.TestCase):
    def job(self, input_url: str = "https://files.example/job.zip", output: str = "both") -> str:
        query = urllib.parse.urlencode({"v": "1", "input": input_url, "output": output})
        return "https://www.ledmapper.com/produce/?" + query

    def test_parse_job_url(self) -> None:
        job = producer.parse_job_url(self.job())
        self.assertEqual(job.input_url, "https://files.example/job.zip")
        self.assertEqual(job.output, "both")

    def test_duplicate_version_and_credentials_are_rejected(self) -> None:
        duplicate = self.job() + "&v=1"
        credentialed = self.job("https://user:secret@files.example/job.zip")
        for url in (duplicate, credentialed):
            with self.subTest(url=producer.redact_url(url)), self.assertRaises(producer.ProducerError):
                producer.parse_job_url(url)

    def test_network_policy_rejects_non_public_addresses(self) -> None:
        def resolver(*_args, **_kwargs):
            return [(2, 1, 6, "", ("127.0.0.1", 443))]

        with self.assertRaisesRegex(producer.ProducerError, "non-public"):
            producer.validate_http_url("https://localhost/input.zip", resolver=resolver)
        parsed = producer.validate_http_url(
            "https://localhost/input.zip", allow_private_network=True, resolver=resolver
        )
        self.assertEqual(parsed.hostname, "localhost")

    def test_network_policy_accepts_public_address(self) -> None:
        def resolver(*_args, **_kwargs):
            return [(2, 1, 6, "", ("93.184.216.34", 443))]

        parsed = producer.validate_http_url("https://example.com/input.zip", resolver=resolver)
        self.assertEqual(parsed.hostname, "example.com")

    def test_invalid_port_and_unescaped_unicode_are_rejected(self) -> None:
        for url in ("https://example.com:0/input.zip", "https://example.com/café.zip"):
            with self.subTest(url=url), self.assertRaises(producer.ProducerError):
                producer.validate_http_url(url, resolve=False)

    def test_ipv6_host_header_is_bracketed(self) -> None:
        class FakeSocket:
            def __init__(self) -> None:
                self.request = b""

            def sendall(self, request: bytes) -> None:
                self.request = request

            def makefile(self, mode: str):
                return io.BytesIO(b"")

            def close(self) -> None:
                pass

        sock = FakeSocket()
        original = producer.socket.create_connection
        producer.socket.create_connection = lambda *args, **kwargs: sock
        try:
            response = producer._open_pinned_response(
                urllib.parse.urlsplit("http://[::1]:8000/input.zip"), "::1", timeout=1
            )
        finally:
            producer.socket.create_connection = original
        self.assertIn(b"Host: [::1]:8000\r\n", sock.request)
        response.close()

    def test_redaction_removes_credentials_query_and_fragment(self) -> None:
        redacted = producer.redact_url("https://user:secret@example.com:8443/a.zip?token=secret#frag")
        self.assertEqual(redacted, "https://example.com:8443/a.zip")
        self.assertNotIn("secret", redacted)


class ManifestAndOutputTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_manifest_contains_hashes_metadata_and_timestamps(self) -> None:
        video = self.root / "source.mp4"
        screenmap = self.root / "screenmap.json"
        artifact = self.root / "result.fled"
        video.write_bytes(b"video")
        screenmap.write_text("{}", encoding="utf-8")
        artifact.write_bytes(b"artifact")
        job = producer.JobRequest(
            "https://app/produce/?v=1",
            "https://files/input.zip?token=secret",
            "fled",
        )
        extracted = producer.ExtractedInput(video, screenmap, "abc123", 42)
        state = {
            "config": {"v": 1, "output": "fled", "input": "https://files/input.zip?token=secret"},
            "inputMetadata": {"duration": 1.5},
            "app": {"version": "1.0.0", "commit": "deadbeef"},
            "progress": {"completedFrames": 45, "totalFrames": 45, "fraction": 1, "fps": 30},
            "artifacts": [{"filename": "result.fled", "frameCount": 45}],
        }
        manifest = producer.build_manifest(
            job, extracted, state, [artifact], started_at="start", completed_at="done"
        )
        self.assertEqual(manifest["input"]["archiveSha256"], "abc123")
        self.assertEqual(manifest["input"]["sourceArchiveUrl"], "https://files/input.zip")
        self.assertEqual(manifest["config"]["input"], "https://files/input.zip")
        self.assertNotIn("secret", json.dumps(manifest))
        self.assertEqual(manifest["app"]["commit"], "deadbeef")
        self.assertEqual(manifest["render"], {"frameCount": 45, "fps": 30})
        self.assertEqual(manifest["timestamps"], {"startedAt": "start", "completedAt": "done"})
        self.assertEqual(manifest["artifacts"][0]["sha256"], producer.sha256_file(artifact))

    def test_output_zip_contains_manifest_and_artifact_with_deflate(self) -> None:
        artifact = self.root / "result.mp4"
        artifact.write_bytes(b"video artifact" * 100)
        destination = self.root / "final.zip"
        producer.create_output_zip(destination, {"manifestVersion": 1}, [artifact])
        with zipfile.ZipFile(destination) as archive:
            self.assertEqual(set(archive.namelist()), {"manifest.json", "result.mp4"})
            self.assertTrue(all(info.compress_type == zipfile.ZIP_DEFLATED for info in archive.infolist()))
            self.assertEqual(json.loads(archive.read("manifest.json"))["manifestVersion"], 1)
            self.assertEqual(archive.read("result.mp4"), artifact.read_bytes())

    def test_output_zip_does_not_replace_existing_package(self) -> None:
        artifact = self.root / "result.fled"
        artifact.write_bytes(b"artifact")
        destination = self.root / "final.zip"
        destination.write_bytes(b"existing")
        with self.assertRaisesRegex(producer.ProducerError, "already exists"):
            producer.create_output_zip(destination, {"manifestVersion": 1}, [artifact])
        self.assertEqual(destination.read_bytes(), b"existing")

    def test_module_import_does_not_require_playwright(self) -> None:
        self.assertNotIn("playwright", producer.__dict__)


if __name__ == "__main__":
    unittest.main()
