export function parse_shape_data_csv(text) {
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

export function parse_shape_data_json(jsonBlob) {
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
        return out;
    } catch (e) {
        alert("Error parsing JSON: " + e);
        throw e;
    }
}

export function is_json_str(text) {
    try {
        JSON.parse(text);
        return true;
    } catch (e) {
        return false;
    }
}

export function parse_shape_data(text) {
    if (is_json_str(text)) {
        return parse_shape_data_json(text);
    }
    return parse_shape_data_csv(text);
}

export function transform_to_center_of_canvas(shape_pts, canvas_width, canvas_height) {
    const out = [];
    const first_pt = shape_pts[0];
    let xmin = first_pt[0];
    let ymin = first_pt[1];
    let xmax = xmin;
    let ymax = ymin;
    shape_pts.forEach(([x,y]) => {
        xmin = Math.min(x, xmin);
        ymin = Math.min(y, ymin);
        xmax = Math.max(x, xmax);
        ymax = Math.max(y, ymax);
    });
    const width  = xmax - xmin;
    const height = ymax - ymin;
    const xcenter = (xmax + xmin) / 2;
    const ycenter = (ymax + ymin) / 2;

    const xscale = .95 * canvas_width / width;
    const yscale = .95 * canvas_height / height;
    const min_scale = yscale < xscale ? yscale : xscale;
    shape_pts.forEach(([x,y]) => {
        x -= xcenter;
        y -= ycenter;
        x *= min_scale;
        y *= min_scale;
        x += canvas_width / 2;
        y += canvas_height / 2;
        out.push([x,y]);
    });
    return out;
}

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

export function download_binary_as_file(uint8_array, filename) {
    const blob = new Blob([uint8_array.buffer], { type: 'application/octet-stream' });
    download_blob_as_file(blob, filename);
}

export function download_text_as_file(text, filename, options = {}) {
    const type = options.type || 'text/plain';
    const blob = new Blob([text], { type: type });
    download_blob_as_file(blob, filename);
}

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
