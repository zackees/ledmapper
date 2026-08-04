"""Entrypoint for the no-mount sidecar container proof."""
import json
import threading
from pathlib import Path

from production_sidecar import ProductionSidecar, SidecarHttpServer

root = Path("/jobs")
root.mkdir()
video = root / "producer-only-video.mp4"; video.write_bytes(b"not-mounted-video")
screenmap = root / "producer-only-screenmap.json"; screenmap.write_text('{"map":{"strip":{"x":[0],"y":[0]}}}')
service = ProductionSidecar(root)
token = service.register_job("isolated", video=video, screenmap=screenmap)
server = SidecarHttpServer(service, host="0.0.0.0", port=8080, allow_private_bind=True,
                           allowed_hosts={"sidecar"}, allowed_origins={"null"})
print(json.dumps({"token": token}), flush=True)
server.serve_forever()
