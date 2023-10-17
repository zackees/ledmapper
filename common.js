function parse_shape_data(text) {
    let out = [];
    text.split("\n").forEach((line) => {
        let d = line.split(",");
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


function transform_to_center_of_canvas(shape_pts, canvas_width, canvas_height) {
    out = []
    const first_pt = shape_pts[0];
    let xmin = first_pt[0];
    let ymin = first_pt[1];
    let xmax = xmin;
    let ymax = ymin;
    shape_pts.forEach(([x,y]) => {
        xmin = min(x, xmin);
        ymin = min(y, ymin);
        xmax = max(x, xmax);
        ymax = max(y, ymax);
    });
    const width  = xmax - xmin;
    const height = ymax - ymin;
    let xcenter = (xmax + xmin) / 2;
    let ycenter = (ymax + ymin) / 2;

    const xscale = .95 * canvas_width / width;
    const yscale = .95 * canvas_height / height;
    const min_scale = yscale < xscale ? yscale : xscale;
    shape_pts.forEach(([x,y]) => {
        // Add small offset so that the first point is near the
        // edge but not cut off down the middle.
        x -= xcenter;
        y -= ycenter;
        x *= min_scale;
        y *= min_scale;
        x += canvas.width / 2;
        y += canvas.height / 2;
        out.push([x,y]);
    });
    return out;
}

// Example download_blob_as_file(new Blob([uint8_array.buffer], { type: 'application/octet-stream' });)
function download_blob_as_file(blob, filename) {
    let link = document.createElement('a');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.download = filename;
    link.href = URL.createObjectURL(blob);
    print("href: ", link.href);
    link.click();
    document.body.removeChild(link);
    // Cleanup after one minute.
    setTimeout(() => {URL.revokeObjectURL(link.href)}, 60 * 1000);
}

function download_binary_as_file(uint8_array, filename) {
    let blob = new Blob([uint8_array.buffer], { type: 'application/octet-stream' });
    download_blob_as_file(blob, filename);
}

function download_text_as_file(text, filename) {
    let blob = new Blob([text], { type: 'text/plain' });
    download_blob_as_file(blob, filename);
}


function estimate_led_size(pts) {
    // The actual algorithm is O(n^2), yuck... At this point just assume led size
    // by the median distance between this led and the next.
    if (pts.length < 2) {
        return 1.0;
    }
    const a = pts[0];
    const b = pts[1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d2 = Math.pow(dx, 2) + Math.pow(dy, 2);
    return Math.sqrt(d2);
}