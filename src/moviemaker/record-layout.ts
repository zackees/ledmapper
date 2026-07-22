import { buildVideoChannelMap } from './transforms';
import { computeCenterFitScale, parseScreenmapMultiStrip } from '../common';
import type { MultiStripParseResult, ParsedStrip, StripPoint } from '../types/domain';

export interface RecordShape {
    name: string;
    type: 'el_panel' | 'el_wire';
    offset: number;
    vertices: StripPoint[];
    thickness?: number;
}

export interface PreparedRecordLayout {
    jsonText: string;
    parsed: MultiStripParseResult;
    channelCount: number;
    ledCount: number;
    shapeCount: number;
    samplePoints: StripPoint[];
    ledPoints: StripPoint[];
    ledPointChannelOffsets: number[];
    shapes: RecordShape[];
    overlayLedStrips: ParsedStrip[];
    videoChannelMap: Int32Array | null;
    fitScale: number;
}

const FIT_OPTIONS = { margin: 20, center: 'origin' as const, pixelAlignScale: true };
const EPSILON = 1e-9;

function finitePoint(point: StripPoint | undefined): point is StripPoint {
    return point !== undefined && Number.isFinite(point[0]) && Number.isFinite(point[1]);
}

function meanAnchor(vertices: StripPoint[]): StripPoint {
    const finite = vertices.filter(finitePoint);
    if (finite.length === 0) throw new Error('EL geometry has no finite vertices');
    const sum = finite.reduce(([sx, sy], [x, y]) => [sx + x, sy + y], [0, 0]);
    return [sum[0] / finite.length, sum[1] / finite.length];
}

export function polygonCentroid(vertices: StripPoint[]): StripPoint {
    if (vertices.length < 3) return meanAnchor(vertices);
    let twiceArea = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        if (!finitePoint(a) || !finitePoint(b)) return meanAnchor(vertices);
        const cross = a[0] * b[1] - b[0] * a[1];
        twiceArea += cross;
        cx += (a[0] + b[0]) * cross;
        cy += (a[1] + b[1]) * cross;
    }
    if (Math.abs(twiceArea) < EPSILON) return meanAnchor(vertices);
    return [cx / (3 * twiceArea), cy / (3 * twiceArea)];
}

export function polylineMidpoint(vertices: StripPoint[]): StripPoint {
    if (vertices.length === 0) throw new Error('EL wire has no vertices');
    if (vertices.length === 1) return meanAnchor(vertices);
    let total = 0;
    for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1];
        const b = vertices[i];
        if (!finitePoint(a) || !finitePoint(b)) return meanAnchor(vertices);
        total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    if (total < EPSILON) return meanAnchor(vertices);
    const target = total / 2;
    let walked = 0;
    for (let i = 1; i < vertices.length; i++) {
        const a = vertices[i - 1];
        const b = vertices[i];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (walked + length >= target) {
            const t = (target - walked) / Math.max(length, EPSILON);
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        }
        walked += length;
    }
    return vertices[vertices.length - 1] ?? meanAnchor(vertices);
}

function anchorForStrip(strip: ParsedStrip): StripPoint {
    const vertices = strip.vertices ?? [];
    return strip.type === 'el_wire' ? polylineMidpoint(vertices) : polygonCentroid(vertices);
}

function fitPoints(points: StripPoint[], sourceGeometry: StripPoint[], width: number, height: number, scale: number): StripPoint[] {
    if (points.length === 0) return [];
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    for (const [x, y] of sourceGeometry) {
        xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    }
    const xcenter = (xmin + xmax) / 2;
    const ycenter = (ymin + ymax) / 2;
    // The origin-centered form is what the moviemaker rotation/translation
    // controls expect. width/height are accepted to keep the helper's fit
    // contract explicit and to make resolution changes visible at call sites.
    void width; void height;
    return points.map(([x, y]) => [(x - xcenter) * scale, (y - ycenter) * scale]);
}

export function prepareRecordLayout(jsonText: string, width: number, height: number): PreparedRecordLayout {
    const parsed = parseScreenmapMultiStrip(jsonText);
    const channelCount = parsed.channelCount ?? parsed.totalCount;
    if (!Number.isInteger(channelCount) || channelCount <= 0) throw new Error('Screenmap has no output channels');

    const sourceGeometry: StripPoint[] = [];
    const sampleRaw: StripPoint[] = [];
    const ledRaw: StripPoint[] = [];
    const ledPointChannelOffsets: number[] = [];
    const shapesRaw: { strip: ParsedStrip; vertices: StripPoint[] }[] = [];
    for (const strip of parsed.strips) {
        if (strip.type === 'led_strip' || strip.type === undefined) {
            sourceGeometry.push(...strip.points);
            ledRaw.push(...strip.points);
            for (let i = 0; i < strip.points.length; i++) ledPointChannelOffsets.push(strip.offset + i);
            sampleRaw.push(...strip.points);
        } else {
            const vertices = strip.vertices ?? [];
            sourceGeometry.push(...vertices);
            sampleRaw.push(anchorForStrip(strip));
            shapesRaw.push({ strip, vertices });
        }
    }
    if (sampleRaw.length !== channelCount) {
        throw new Error(`Screenmap channel/sample mismatch: ${String(channelCount)} != ${String(sampleRaw.length)}`);
    }
    if (sourceGeometry.length === 0) throw new Error('Screenmap has no drawable geometry');
    if (!sourceGeometry.every(finitePoint) || !sampleRaw.every(finitePoint)) throw new Error('Screenmap geometry is not finite');

    const fitScale = computeCenterFitScale(sourceGeometry, width, height, FIT_OPTIONS);
    const samplePoints = fitPoints(sampleRaw, sourceGeometry, width, height, fitScale);
    const ledPoints = fitPoints(ledRaw, sourceGeometry, width, height, fitScale);
    const shapes = shapesRaw.map(({ strip, vertices }) => ({
        name: strip.name,
        type: strip.type as 'el_panel' | 'el_wire',
        offset: strip.offset,
        vertices: fitPoints(vertices, sourceGeometry, width, height, fitScale),
        ...(strip.thickness !== undefined ? { thickness: strip.thickness * fitScale } : {}),
    }));
    const overlayLedStrips: ParsedStrip[] = [];
    let ledCursor = 0;
    for (const strip of parsed.strips) {
        if (strip.type !== 'led_strip' && strip.type !== undefined) continue;
        overlayLedStrips.push({ ...strip, offset: ledCursor, count: strip.points.length });
        ledCursor += strip.points.length;
    }
    return {
        jsonText,
        parsed,
        channelCount,
        ledCount: ledPoints.length,
        shapeCount: shapes.length,
        samplePoints,
        ledPoints,
        ledPointChannelOffsets,
        shapes,
        overlayLedStrips,
        videoChannelMap: buildVideoChannelMap(parsed.strips, channelCount),
        fitScale,
    };
}
