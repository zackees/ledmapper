"""Geometry shared by production-video evaluator scripts.

The unattended production renderer calls ``preview.render(..., null, ...)``.
Consequently ``preview.ts::fitCamera`` fits the point-coordinate extent with
the 1.05 aesthetic margin and deliberately excludes LED visual radius.  Keep
this helper synchronized with that production call and camera formula; using
declared map diameter here would sample a different lattice than the video.
"""

from __future__ import annotations

import numpy as np

PRODUCTION_CAMERA_MARGIN = 1.05


def production_led_positions(size: int, grid: int = 64) -> np.ndarray:
    """Return production-preview LED centers along one square-canvas axis."""
    if grid < 2:
        raise ValueError("grid must contain at least two points")
    normalized = np.arange(grid, dtype=np.float64) / (grid - 1) - 0.5
    return size / 2 + normalized * size / PRODUCTION_CAMERA_MARGIN
