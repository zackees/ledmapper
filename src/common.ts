import type { ScreenmapJson, StripPoint, MultiStripParseResult, ParsedStrip } from './types/domain';
import { detectScreenmapVersion, parseScreenmapV2, v2ToMultiStripResult } from './screenmap-v2';
import { createLogger } from './debug-log';

const log = createLogger('common');

/** Array of [x,y] points with an optional diameter side-property. */
export type PointArrayWithDiameter = StripPoint[] & { diameter?: number };

/**
 * Parse screenmap data from CSV text (one point per line: x,y).
 */
export function parse_screenmap_data_csv(text: string): StripPoint[] {
    const out: StripPoint[] = [];
    text.split("\n").forEach((line: string) => {
        const d = line.split(",");
        while (d.length > 2) { d.splice(0, 1); }
        const x = Number.parseFloat(d[0] ?? '');
        const y = Number.parseFloat(d[1] ?? '');
        if (Object.is(x, NaN) || Object.is(y, NaN)) {
            return;
        }
        out.push([x, y]);
    });
    return out;
}

/**
 * Parse screenmap data from JSON format.
 * Returns an Array with an optional `.diameter` property.
 */
export function parse_screenmap_data_json(jsonBlob: string | ScreenmapJson): PointArrayWithDiameter {
    let parsed: ScreenmapJson;
    if (typeof jsonBlob === "string") {
        parsed = JSON.parse(jsonBlob) as ScreenmapJson;
    } else {
        parsed = jsonBlob;
    }
    try {
        const out: PointArrayWithDiameter = [];
        if (detectScreenmapVersion(parsed) === 2) {
            const multi = v2ToMultiStripResult(parseScreenmapV2(parsed));
            let firstDiameter: number | undefined;
            for (const strip of multi.strips) {
                for (const pt of strip.points) out.push(pt);
                if (firstDiameter === undefined && typeof strip.diameter === "number") {
                    firstDiameter = strip.diameter;
                }
            }
            if (typeof firstDiameter === "number") out.diameter = firstDiameter;
            return out;
        }
        if (parsed.map === undefined) {
            throw new Error("Missing required 'map' key in screenmap JSON");
        }
        const map = parsed.map;
        const keys = Object.keys(map);
        if (keys.length === 0) {
            throw new Error("No strip data found");
        }
        let firstDiameter: number | undefined;
        for (const key of keys) {
            const strip = map[key];
            if (strip === undefined) continue;
            const { x, y } = strip;
            // Surface mismatched x/y arrays — silently truncating to the
            // shorter axis would produce ghost LEDs at [0,0] downstream. #182.
            if (x.length !== y.length) {
                log.warn('strip-length-mismatch', { key, xLength: x.length, yLength: y.length });
            }
            const len = Math.min(x.length, y.length);
            for (let i = 0; i < len; ++i) {
                out.push([x[i] ?? 0, y[i] ?? 0]);
            }
            if (firstDiameter === undefined && typeof strip.diameter === "number") {
                firstDiameter = strip.diameter;
            }
        }
        if (typeof firstDiameter === "number") {
            out.diameter = firstDiameter;
        }
        return out;
    } catch (e) {
        // Callers handle the user-facing error path (each tool catches and
        // shows its own dialog with appropriate context). Just rethrow so
        // common.ts stays presentation-free.
        log.error('json-parse-error', { error: String(e) });
        throw e;
    }
}

/**
 * Parse screenmap data into a multi-strip structured result.
 * Auto-detects JSON vs CSV. CSV is wrapped as a single strip named "strip1".
 */
export function parseScreenmapMultiStrip(text: string | ScreenmapJson): MultiStripParseResult {
    if (typeof text === 'object') {
        return _routeMultiStrip(text);
    }
    if (is_json_str(text)) {
        return _routeMultiStrip(JSON.parse(text) as ScreenmapJson);
    }
    // CSV fallback — wrap in single strip
    const pts = parse_screenmap_data_csv(text);
    return {
        strips: [{
            name: 'strip1', points: pts, diameter: undefined, offset: 0,
            count: pts.length, video_offset: 0,
            pin: 'pin1', videoOffsetOverride: false,
        }],
        allPoints: pts,
        totalCount: pts.length,
    };
}

/**
 * Dispatch on detected version. v2 documents are converted onto the
 * v1-style MultiStripParseResult so downstream tools keep working unchanged.
 */
function _routeMultiStrip(obj: ScreenmapJson): MultiStripParseResult {
    const version = detectScreenmapVersion(obj);
    if (version === 2) {
        return v2ToMultiStripResult(parseScreenmapV2(obj));
    }
    return _parseMultiStripJson(obj);
}

function _parseMultiStripJson(obj: ScreenmapJson): MultiStripParseResult {
    if (obj.map === undefined) {
        throw new Error("Missing required 'map' key in screenmap JSON");
    }
    const map = obj.map;
    const keys = Object.keys(map);
    if (keys.length === 0) {
        throw new Error("No strip data found");
    }
    const strips: ParsedStrip[] = [];
    const allPoints: StripPoint[] = [];
    let offset = 0;
    for (const key of keys) {
        const strip = map[key];
        if (strip === undefined) continue;
        const { x, y } = strip;
        const points: StripPoint[] = [];
        const len = Math.min(x.length, y.length);
        for (let i = 0; i < len; ++i) {
            const pt: StripPoint = [x[i] ?? 0, y[i] ?? 0];
            points.push(pt);
            allPoints.push(pt);
        }
        const diameter = typeof strip.diameter === "number" ? strip.diameter : undefined;
        const video_offset = typeof strip.video_offset === "number" ? strip.video_offset : offset;
        const rawPin = strip.pin;
        const pin = (typeof rawPin === "string" && rawPin.trim() !== "") ? rawPin : "pin1";
        const videoOffsetOverride = typeof strip.video_offset_override === "boolean"
            ? strip.video_offset_override
            : (typeof strip.video_offset === "number" && strip.video_offset !== offset);
        strips.push({
            name: key, points, diameter, offset, count: points.length,
            video_offset, pin, videoOffsetOverride,
        });
        offset += points.length;
    }
    return { strips, allPoints, totalCount: allPoints.length };
}

/**
 * Generate N distinct colors for strip visualization.
 */
export function getStripColors(n: number): string[] {
    const colors: string[] = [];
    for (let i = 0; i < n; i++) {
        const hue = (i * 360 / n) % 360;
        colors.push(`hsl(${String(hue)}, 80%, 60%)`);
    }
    return colors;
}

/**
 * Generate N distinct pin tint colors.
 */
export function getPinColors(n: number): string[] {
    const colors: string[] = [];
    const count = Math.max(1, n);
    for (let i = 0; i < n; i++) {
        const hue = (210 + i * 360 / count) % 360;
        colors.push(`hsl(${String(hue)}, 65%, 55%)`);
    }
    return colors;
}

/**
 * Build the Start/End overlay labels for a strip.
 */
export function stripStartEndLabels(
    strip: { name?: string; count?: number; points?: StripPoint[] },
    index: number,
): { start: string; end: string | null } {
    const rawName = typeof strip.name === 'string' ? strip.name.trim() : '';
    const isAutoIndexed = rawName === '' || /^strip\d*$/i.test(rawName);
    const name = isAutoIndexed ? String(index) : rawName;
    const count = typeof strip.count === 'number'
        ? strip.count
        : (strip.points ? strip.points.length : undefined);
    if (count === 1) {
        return { start: `Start/End${name}`, end: null };
    }
    return { start: `Start${name}`, end: `End${name}` };
}

/**
 * Check if a string is valid JSON.
 */
export function is_json_str(text: string): boolean {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse screenmap data from either JSON or CSV format (auto-detected).
 */
export function parse_screenmap_data(text: string): PointArrayWithDiameter {
    if (is_json_str(text)) {
        return parse_screenmap_data_json(text);
    }
    const pts = parse_screenmap_data_csv(text);
    // CSV has no diameter info; leave pts.diameter undefined
    return pts;
}

/**
 * Center and scale points to fit within given dimensions.
 */
export function centerAndFitPoints(
    pts: StripPoint[],
    width: number,
    height: number,
    { margin = 0.95, center = 'canvas' }: { margin?: number; center?: string } = {},
): StripPoint[] {
    if (pts.length === 0) return [];

    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    pts.forEach(([x, y]) => {
        xmin = Math.min(xmin, x); xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
    });

    const xcenter = (xmin + xmax) / 2;
    const ycenter = (ymin + ymax) / 2;
    const w = xmax - xmin;
    const h = ymax - ymin;

    let availW, availH;
    if (margin <= 1) {
        availW = margin * width;
        availH = margin * height;
    } else {
        availW = width - 2 * margin;
        availH = height - 2 * margin;
    }

    const scaleX = w > 0 ? availW / w : availW;
    const scaleY = h > 0 ? availH / h : availH;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = center === 'canvas' ? width / 2 : 0;
    const offsetY = center === 'canvas' ? height / 2 : 0;

    return pts.map(([x, y]) => [
        (x - xcenter) * scale + offsetX,
        (y - ycenter) * scale + offsetY,
    ]);
}

/** @deprecated Use centerAndFitPoints instead */
export function transform_to_center_of_canvas(
    screenmap_pts: StripPoint[],
    canvas_width: number,
    canvas_height: number,
): StripPoint[] {
    return centerAndFitPoints(screenmap_pts, canvas_width, canvas_height, { margin: 0.95, center: 'canvas' });
}

/**
 * Read a file input's selected file as text.
 */
export function readFileAsText(fileInput: HTMLInputElement, onText: (text: string) => void): void {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        const result = evt.target?.result;
        if (typeof result === 'string') { onText(result); }
    };
    reader.readAsText(file);
}

/**
 * Download a Blob as a file via a temporary link.
 */
export function download_blob_as_file(blob: Blob, filename: string): void {
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    // href logged for debug; use console.warn to satisfy no-console rule in production
    // console.log("href: ", link.href); // removed
    link.click();
    document.body.removeChild(link);
    setTimeout(() => {URL.revokeObjectURL(link.href);}, 60 * 1000);
}

/**
 * Download a Uint8Array as a binary file.
 */
export function download_binary_as_file(uint8_array: Uint8Array, filename: string): void {
    const blob = new Blob([uint8_array.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    download_blob_as_file(blob, filename);
}

/**
 * Download text content as a file.
 */
export function download_text_as_file(
    text: string,
    filename: string,
    options: { type?: string } = {},
): void {
    const type = options.type ?? 'text/plain';
    const blob = new Blob([text], { type: type });
    download_blob_as_file(blob, filename);
}

/**
 * Estimate LED diameter from the distance between the first two points.
 * @deprecated Use estimateLedSize from moviemaker/transforms.ts instead
 */
export function estimate_led_size(pts: StripPoint[]): number {
    if (pts.length < 2) {
        return 1.0;
    }
    // pts.length >= 2 checked above; fallback [0,0] satisfies TS but is unreachable
    const [ax, ay] = pts[0] ?? [0, 0];
    const [bx, by] = pts[1] ?? [0, 0];
    const dx = bx - ax;
    const dy = by - ay;
    const d2 = Math.pow(dx, 2) + Math.pow(dy, 2);
    return Math.max(Math.sqrt(d2), 1.0);
}
