/**
 * Shared bloom-geometry reproportioning. Demo and Movie Player both need to
 * re-fit the bloom kernel + density envelope to the current point cloud whenever
 * the geometry or LED diameter changes; this is the single source of truth for
 * that bbox + spacing computation.
 */
import type { AutoBloomGeometry } from '../auto-bloom.js';
import { estimateLedSize } from '../moviemaker/transforms.js';
import type { StripPoint } from '../types/domain.js';

interface BloomGeometryTarget {
    setGeometry: (geometry: AutoBloomGeometry) => void;
}

/**
 * Recompute the scene bounding box + LED spacing for `points` and push it into
 * the bloom controller. `ledPx` is the PointsMaterial size in CSS pixels;
 * `panePx` is the canvas size. No-op for fewer than two points.
 */
export function applyBloomGeometry(
    bloom: BloomGeometryTarget,
    points: StripPoint[],
    { ledPx, panePx }: { ledPx: number; panePx: number },
): void {
    if (points.length < 2) return;
    const spacing = estimateLedSize(points);
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of points) {
        if (x < xmin) xmin = x; if (x > xmax) xmax = x;
        if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    }
    const extent = Math.max(xmax - xmin, ymax - ymin, 1e-6);
    bloom.setGeometry({
        ledPx,
        panePx,
        ledCount: points.length,
        ledSpacing: spacing,
        sceneExtent: extent,
    });
}
