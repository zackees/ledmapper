
const dom_btn_submit = document.getElementById("btn_submit");
const dom_ta_shape_input = document.getElementById("ta_shape_input");

const movie_width = 1280;
const movie_height = 720;

let canvas;
let capture;
let shape_pts = [];
let target_zoom = 1.;
let curr_zoom = target_zoom;
let curr_rotate = 0;
let target_rotate = 0;

let target_translate = [movie_width / 2, movie_height / 2];
let curr_translate = [movie_width / 2, movie_height / 2];

let shift_active = false;
document.onkeydown = (evt) => {
    if ("Shift" == evt.key) {
        shift_active = true;
    }
};

document.onkeyup = (evt) => {
    if ("Shift" == evt.key) {
        shift_active = false;
    }
};

dom_btn_submit.onclick = () => {
    shape_pts = [];
    const data = dom_ta_shape_input.value;
    data.split("\n").forEach((line) => {
        let d = line.split(",");
        while (d.length > 2) { d.splice(0, 1); }
        const x = Number.parseInt(d[0]);
        const y = Number.parseInt(d[1]);
        if (Object.is(x, NaN) || Object.is(y, NaN)) {
            return;
        }
        shape_pts.push([x, y]);
    });
    if (shape_pts.length == 0) {
        return;
    }
    // now format so that the entire thing is contained in the
    // canvas.
    const first_pt = shape_pts[0];
    let xmin = first_pt[0];
    let ymin = first_pt[1];
    let xavg = 0;
    let yavg = 0;
    shape_pts.forEach(([x, y]) => {
        xavg += x;
        yavg += y;
        if (x < xmin) { xmin = x; }
        if (y < ymin) { ymin = y; }
    });
    xavg /= shape_pts.length;
    yavg /= shape_pts.length;
    shape_pts.forEach((pt) => {
        // Add small offset so that the first point is near the
        // edge but not cut off down the middle.
        pt[0] = pt[0] - xavg;
        pt[1] = pt[1] - yavg;
    });
};

function mouseWheel(event) {
    // Change the red value according
    // to the scroll delta value
    //console.log("mouseWheel", mouseX, mouseY, event.delta);
    //event.
    if (mouseY < 0 || mouseY > movie_height || mouseX < 0 || mouseX > movie_width) {
        // Not in canvas so ignore.
        return true;
    }
    if (shift_active) {
        target_rotate += event.delta > 0 ? 1 : -1;
        return;
    }
    target_zoom -= event.delta / 10000;  // Typical scroll amount is 200.
    target_zoom = Math.max(target_zoom, 0.05);
    return false;
}

// The statements in the setup() function
// execute once when the program begins
function setup() {
    // createCanvas must be the first statement
    pixelDensity(1);  // Needed for retina displays.
    canvas = createCanvas(movie_width, movie_height);
    stroke(255); // Set line drawing color to white
    frameRate(30);
    capture = createCapture(VIDEO);
    capture.size(movie_width, movie_height);
    capture.hide();
}
// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
function draw() {
    background(0); // Set the background to black
    if (mouseIsPressed && mouseY > 0) {
        target_translate[0] = mouseX;
        target_translate[1] = mouseY;
    }
    if (target_translate !== curr_translate) {
        const diff_x = target_translate[0] - curr_translate[0];
        const diff_y = target_translate[1] - curr_translate[1];
        if (Math.abs(diff_x) < .05) {
            curr_translate[0] = target_translate[0];
        } else {
            curr_translate[0] += diff_x * .05;
        }
        if (Math.abs(diff_y) < .05) {
            curr_translate[1] = target_translate[1];
        } else {
            curr_translate[1] += diff_y * .05;
        }
    }

    if (curr_zoom !== target_zoom) {
        const diff = target_zoom - curr_zoom;
        if (Math.abs(diff) < .00010) {
            curr_zoom = target_zoom;
        } else {
            curr_zoom += diff * .1;
        }
    }

    if (shape_pts.length == 0) {
        return;  // nothing left to draw
    }

    if (curr_rotate !== target_rotate) {
        const diff_r = target_rotate - curr_rotate;
        if (Math.abs(diff_r) < .05) {
            curr_rotate = target_rotate;
        } else {
            curr_rotate += diff_r * .1;
        }
    }

    // Deep copy.
    let transformed_pts = [];
    shape_pts.forEach(([x, y]) => { transformed_pts.push([x, y]); });

    if (curr_rotate != 0) {
        // apply 2d rotation.
        transformed_pts.forEach((pt) => {
            const r = radians(curr_rotate);
            // get magnitude of said point.
            const mag = Math.sqrt(pt[0]*pt[0] + pt[1]*pt[1]);
            // project point onto sphere.
            let x = pt[0] / mag;
            let y = pt[1] / mag;
            const cos_r = Math.cos(r);
            const sin_r = Math.sin(r);
            // Apply matrix rotation.
            const xx = x*cos_r + y*sin_r;
            const yy = -(x*sin_r) + y*cos_r;
            // Project back to real space from the unit sphere.
            pt[0] = xx * mag;
            pt[1] = yy * mag;
        });
    }

    //console.log(curr_zoom, target_zoom);
    //let transformed_pts = [];
    transformed_pts.forEach((pt) => {
        pt[0] *= curr_zoom;
        pt[1] *= curr_zoom;
        pt[0] += curr_translate[0];
        pt[1] += curr_translate[1];
    });

    noFill();
    stroke(color('white'));
    for (let i = 0; i < transformed_pts.length; ++i) {
        let r = 6;
        const [x, y] = transformed_pts[i];
        circle(x, y, r);
    }
}
