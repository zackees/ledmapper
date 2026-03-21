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
        let strip1 = map["strip1"];
        // we prefer strip1, else use the first strip.
        if (!strip1) {
            const keys = Object.keys(map);
            if (keys.length > 0) {
                strip1 = map[keys[0]];
            }
        }
        if (!strip1) {
            throw "No strip data found";
        }
        const x = strip1["x"];
        const y = strip1["y"];
        if (!x) {
            throw "No x data found";
        }
        if (!y) {
            throw "No y data found";
        }
        for (let i = 0; i < x.length; ++i) {
            out.push([x[i], y[i]]);
        }
        if (typeof strip1["diameter"] === "number") {
            out.diameter = strip1["diameter"];
        }
        return out;
    } catch (e) {
        alert("Error parsing JSON: " + e);
        throw e;
    }
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
    } catch (e) {
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
