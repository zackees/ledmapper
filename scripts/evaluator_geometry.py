"""Geometry shared by production-video evaluator scripts.

The unattended production renderer calls ``preview.render(..., null, ...)``.
Consequently ``preview.ts::fitCamera`` fits the point-coordinate extent with
the 1.05 aesthetic margin and deliberately excludes LED visual radius.  Keep
this helper synchronized with that production call and camera formula; using
declared map diameter here would sample a different lattice than the video.
"""

from __future__ import annotations

import math

import numpy as np

PRODUCTION_CAMERA_MARGIN = 1.05


def production_led_positions(size: int, grid: int = 64) -> np.ndarray:
    """Return production-preview LED centers along one square-canvas axis."""
    if grid < 2:
        raise ValueError("grid must contain at least two points")
    normalized = np.arange(grid, dtype=np.float64) / (grid - 1) - 0.5
    return size / 2 + normalized * size / PRODUCTION_CAMERA_MARGIN


def production_led_centers(
    size: int,
    grid: int = 64,
    rotation_degrees: float = 0,
) -> tuple[np.ndarray, float]:
    """Return ``[grid, grid, (x, y)]`` centers and nearest-neighbour pitch.

    This mirrors ``preview.ts::fitCamera`` for a square point grid when
    production passes ``ledDiameter=null``.  The camera fits the rotated AABB,
    so a 45-degree panel has a smaller on-canvas pitch than an upright panel.
    """
    if grid < 2:
        raise ValueError("grid must contain at least two points")
    axis = np.arange(grid, dtype=np.float64) / (grid - 1) - 0.5
    xx, yy = np.meshgrid(axis, axis)
    radians = math.radians(rotation_degrees)
    cosine, sine = math.cos(radians), math.sin(radians)
    rotated_x = xx * cosine - yy * sine
    rotated_y = xx * sine + yy * cosine
    camera_extent = max(abs(cosine) + abs(sine), 1e-9)
    scale = size / (camera_extent * PRODUCTION_CAMERA_MARGIN)
    centers = np.stack(
        (size / 2 + rotated_x * scale, size / 2 + rotated_y * scale),
        axis=-1,
    )
    pitch = scale / (grid - 1)
    return centers, pitch
