/**
 * Parse screenmap data from CSV text (one point per line: x,y).
 * @param {string} text - CSV content
 * @returns {Array<[number,number]>}
 */
export function parse_screenmap_data_csv(text) {
    const out = [];
    text.split("\n").forEach((line) => {
        const d = line.split(",");
        while (d.length > 2) { d.splice(0, 1); }
        const x = Number.parseFloat(d[0]);
        const y = Number.parseFloat(d[1]);
        if (Object.is(x, NaN) || Object.is(y, NaN)) {
            return;
        }
        out.push([x,y]);
    });
    return out;
}

/**
 * Parse screenmap data from JSON format.
 * @param {string|Object} jsonBlob - JSON string or parsed object with {map:{strip1:{x:[],y:[],diameter?}}}
 * @returns {Array<[number,number]>} Array with optional `.diameter` property (number or undefined)
 */
export function parse_screenmap_data_json(jsonBlob) {
    if (typeof jsonBlob === "string")
        jsonBlob = JSON.parse(jsonBlob);
    try {
        const out = [];
        const map = jsonBlob["map"];
        if (!map || typeof map !== "object") {
            throw new Error("No 'map' key found in JSON");
        }
        const keys = Object.keys(map);
        if (keys.length === 0) {
            throw new Error("No strip data found");
        }
        let firstDiameter;
        for (const key of keys) {
            const strip = map[key];
            const x = strip["x"];
            const y = strip["y"];
            if (!x) throw new Error(`No x data found in ${key}`);
            if (!y) throw new Error(`No y data found in ${key}`);
            const len = Math.min(x.length, y.length);
            for (let i = 0; i < len; ++i) {
                out.push([x[i], y[i]]);
            }
            if (firstDiameter === undefined && typeof strip["diameter"] === "number") {
                firstDiameter = strip["diameter"];
            }
        }
        if (typeof firstDiameter === "number") {
            out.diameter = firstDiameter;
        }
        return out;
    } catch (e) {
        if (typeof alert === "function") {
            alert("Error parsing JSON: " + e);
        } else {
            console.error("Error parsing JSON: " + e);
        }
        throw e;
    }
}

/**
 * Parse screenmap data into a multi-strip structured result.
 * Auto-detects JSON vs CSV. CSV is wrapped as a single strip named "strip1".
 *
 * @param {string|Object} text - JSON string, parsed object, or CSV text
 * @returns {{ strips: Array<{name:string, points:Array<[number,number]>, diameter:number|undefined, offset:number, count:number}>, allPoints: Array<[number,number]>, totalCount: number }}
 */
export function parseScreenmapMultiStrip(text) {
    if (typeof text === 'object' && text !== null) {
        return _parseMultiStripJson(text);
    }
    if (is_json_str(text)) {
        return _parseMultiStripJson(JSON.parse(text));
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

function _parseMultiStripJson(obj) {
    const map = obj["map"];
    if (!map || typeof map !== "object") {
        throw new Error("No 'map' key found in JSON");
    }
    const keys = Object.keys(map);
    if (keys.length === 0) {
        throw new Error("No strip data found");
    }
    const strips = [];
    const allPoints = [];
    let offset = 0;
    for (const key of keys) {
        const strip = map[key];
        const x = strip["x"];
        const y = strip["y"];
        if (!x) throw new Error(`No x data found in ${key}`);
        if (!y) throw new Error(`No y data found in ${key}`);
        const points = [];
        const len = Math.min(x.length, y.length);
        for (let i = 0; i < len; ++i) {
            const pt = [x[i], y[i]];
            points.push(pt);
            allPoints.push(pt);
        }
        const diameter = typeof strip["diameter"] === "number" ? strip["diameter"] : undefined;
        const video_offset = typeof strip["video_offset"] === "number" ? strip["video_offset"] : offset;
        // Pin grouping (issue #24): free-form string, default 'pin1'.
        const rawPin = strip["pin"];
        const pin = (typeof rawPin === "string" && rawPin.trim() !== "") ? rawPin : "pin1";
        // videoOffsetOverride: explicit flag wins; legacy migration — a map
        // saved before the override flag existed marks any manually-authored
        // (non-sequential) video_offset as overridden so it survives resave.
        const videoOffsetOverride = typeof strip["video_offset_override"] === "boolean"
            ? strip["video_offset_override"]
            : (typeof strip["video_offset"] === "number" && strip["video_offset"] !== offset);
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
 * @param {number} n - Number of colors needed
 * @returns {string[]} Array of HSL color strings
 */
export function getStripColors(n) {
    const colors = [];
    for (let i = 0; i < n; i++) {
        const hue = (i * 360 / n) % 360;
        colors.push(`hsl(${hue}, 80%, 60%)`);
    }
    return colors;
}

/**
 * Generate N distinct pin tint colors (issue #24 §1.7). Mirrors
 * getStripColors but offset in hue and softer in saturation so a pin badge
 * reads as a different "layer" than the per-strip rainbow.
 * @param {number} n - Number of colors needed
 * @returns {string[]} Array of HSL color strings
 */
export function getPinColors(n) {
    const colors = [];
    const count = Math.max(1, n);
    for (let i = 0; i < n; i++) {
        const hue = (210 + i * 360 / count) % 360;
        colors.push(`hsl(${hue}, 65%, 55%)`);
    }
    return colors;
}

/**
 * Build the Start/End overlay labels for a strip, shared by every tool so
 * the wording cannot drift: `Start<Name>`/`End<Name>` using the strip's JSON
 * map key, falling back to the strip index (`Start0`/`End0`, `Start1`/`End1`,
 * ...) for unnamed or auto-indexed "stripN" names. Single-LED strips collapse
 * to one combined label (end is null).
 *
 * @param {{name?: string, count?: number, points?: Array}} strip
 * @param {number} index - zero-based strip index
 * @returns {{start: string, end: string|null}}
 */
export function stripStartEndLabels(strip, index) {
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
 * @param {string} text
 * @returns {boolean}
 */
export function is_json_str(text) {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/**
 * Parse screenmap data from either JSON or CSV format (auto-detected).
 * @param {string} text - Screenmap data content
 * @returns {Array<[number,number]>}
 */
export function parse_screenmap_data(text) {
    if (is_json_str(text)) {
        return parse_screenmap_data_json(text);
    }
    const pts = parse_screenmap_data_csv(text);
    // CSV has no diameter info; leave pts.diameter undefined
    return pts;
}

/**
 * Center and scale points to fit within given dimensions.
 *
 * @param {Array<[number,number]>} pts - input points
 * @param {number} width - target width
 * @param {number} height - target height
 * @param {Object} [options]
 * @param {number} [options.margin=0.95] - fraction of dimension to use (0-1), or pixel count if > 1
 * @param {'canvas'|'origin'} [options.center='canvas'] - 'canvas' offsets to (width/2, height/2), 'origin' centers at (0,0)
 * @returns {Array<[number,number]>}
 */
export function centerAndFitPoints(pts, width, height, { margin = 0.95, center = 'canvas' } = {}) {
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
        // margin is pixel inset
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
export function transform_to_center_of_canvas(screenmap_pts, canvas_width, canvas_height) {
    return centerAndFitPoints(screenmap_pts, canvas_width, canvas_height, { margin: 0.95, center: 'canvas' });
}

/**
 * Read a file input's selected file as text.
 *
 * @param {HTMLInputElement} fileInput - The file input element
 * @param {function(string): void} onText - Callback receiving file text content
 */
export function readFileAsText(fileInput, onText) {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => { onText(evt.target.result); };
    reader.readAsText(file);
}

/**
 * Download a Blob as a file via a temporary link.
 * @param {Blob} blob
 * @param {string} filename
 */
export function download_blob_as_file(blob, filename) {
    const link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    console.log("href: ", link.href);
    link.click();
    document.body.removeChild(link);
    // Cleanup after one minute.
    setTimeout(() => {URL.revokeObjectURL(link.href)}, 60 * 1000);
}

/**
 * Download a Uint8Array as a binary file.
 * @param {Uint8Array} uint8_array
 * @param {string} filename
 */
export function download_binary_as_file(uint8_array, filename) {
    const blob = new Blob([uint8_array.buffer], { type: 'application/octet-stream' });
    download_blob_as_file(blob, filename);
}

/**
 * Download text content as a file.
 * @param {string} text
 * @param {string} filename
 * @param {Object} [options]
 * @param {string} [options.type='text/plain'] - MIME type
 */
export function download_text_as_file(text, filename, options = {}) {
    const type = options.type || 'text/plain';
    const blob = new Blob([text], { type: type });
    download_blob_as_file(blob, filename);
}

/**
 * Estimate LED diameter from the distance between the first two points.
 * @deprecated Use estimateLedSize from moviemaker/transforms.js instead
 * @param {Array<[number,number]>} pts
 * @returns {number} Minimum 1.0
 */
export function estimate_led_size(pts) {
    if (pts.length < 2) {
        return 1.0;
    }
    const a = pts[0];
    const b = pts[1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d2 = Math.pow(dx, 2) + Math.pow(dy, 2);
    return Math.max(Math.sqrt(d2), 1.0);
}
