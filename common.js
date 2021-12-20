function parse_shape_data(text) {
    let out = [];
    text.split("\n").forEach((line) => {
        let d = line.split(",");
        while (d.length > 2) { d.splice(0, 1); }
        const x = Number.parseInt(d[0]);
        const y = Number.parseInt(d[1]);
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