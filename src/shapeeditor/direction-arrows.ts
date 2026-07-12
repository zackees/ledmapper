export interface DirectionArrowStripRange {
    offset: number;
    count: number;
}

export interface DirectionArrowPlacement {
    x: number;
    y: number;
    angle: number;
    segmentIndex: number;
    stripIndex: number;
    fraction: number;
}

export interface DirectionArrowAnchor {
    segmentIndex: number;
    stripIndex: number;
    fraction: number;
}

export const DIRECTION_ARROW_SPACING_PX = 225;

interface MeasuredSegment {
    from: [number, number];
    to: [number, number];
    length: number;
    startDistance: number;
    segmentIndex: number;
}

/**
 * Place direction arrows by visible CSS-pixel path length, independently per
 * strip. Even spacing avoids endpoint clusters, while a short but non-empty
 * strip still gets one arrow at its visual midpoint.
 */
export function computeDirectionArrowPlacements(
    points: [number, number][],
    strips: DirectionArrowStripRange[],
    targetSpacingPx = DIRECTION_ARROW_SPACING_PX,
): DirectionArrowPlacement[] {
    const spacing = Math.max(1, targetSpacingPx);
    const placements: DirectionArrowPlacement[] = [];

    for (let stripIndex = 0; stripIndex < strips.length; stripIndex++) {
        const strip = strips[stripIndex];
        if (!strip || strip.count < 2) continue;
        const start = Math.max(0, strip.offset);
        const end = Math.min(points.length, start + strip.count);
        const segments: MeasuredSegment[] = [];
        let totalLength = 0;

        for (let pointIndex = start; pointIndex < end - 1; pointIndex++) {
            const from = points[pointIndex];
            const to = points[pointIndex + 1];
            if (!from || !to) continue;
            const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
            if (length <= Number.EPSILON) continue;
            segments.push({ from, to, length, startDistance: totalLength, segmentIndex: pointIndex });
            totalLength += length;
        }

        if (segments.length === 0 || totalLength <= Number.EPSILON) continue;
        const arrowCount = Math.max(1, Math.round(totalLength / spacing));
        const leadingMargin = (totalLength - (arrowCount - 1) * spacing) / 2;
        let segmentCursor = 0;

        for (let arrowIndex = 0; arrowIndex < arrowCount; arrowIndex++) {
            const targetDistance = leadingMargin + arrowIndex * spacing;
            while (
                segmentCursor < segments.length - 1
                && targetDistance > (segments[segmentCursor]?.startDistance ?? 0) + (segments[segmentCursor]?.length ?? 0)
            ) {
                segmentCursor++;
            }
            const segment = segments[segmentCursor];
            if (!segment) continue;
            const along = Math.min(Math.max(targetDistance - segment.startDistance, 0), segment.length);
            const fraction = along / segment.length;
            const dx = segment.to[0] - segment.from[0];
            const dy = segment.to[1] - segment.from[1];
            placements.push({
                x: segment.from[0] + dx * fraction,
                y: segment.from[1] + dy * fraction,
                angle: Math.atan2(dy, dx),
                segmentIndex: segment.segmentIndex,
                stripIndex,
                fraction,
            });
        }
    }

    return placements;
}

export function directionArrowAnchorsFromPlacements(
    placements: DirectionArrowPlacement[],
): DirectionArrowAnchor[] {
    return placements.map(({ segmentIndex, stripIndex, fraction }) => ({
        segmentIndex,
        stripIndex,
        fraction,
    }));
}

/** Reproject a frozen logical layout onto the current canvas-space path. */
export function projectDirectionArrowAnchors(
    points: [number, number][],
    anchors: DirectionArrowAnchor[],
): DirectionArrowPlacement[] {
    const placements: DirectionArrowPlacement[] = [];
    for (const anchor of anchors) {
        const from = points[anchor.segmentIndex];
        const to = points[anchor.segmentIndex + 1];
        if (!from || !to) continue;
        const dx = to[0] - from[0];
        const dy = to[1] - from[1];
        if (Math.hypot(dx, dy) <= Number.EPSILON) continue;
        const fraction = Math.min(1, Math.max(0, anchor.fraction));
        placements.push({
            x: from[0] + dx * fraction,
            y: from[1] + dy * fraction,
            angle: Math.atan2(dy, dx),
            segmentIndex: anchor.segmentIndex,
            stripIndex: anchor.stripIndex,
            fraction,
        });
    }
    return placements;
}
