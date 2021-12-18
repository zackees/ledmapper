
const dom_btn_submit = document.getElementById("btn_submit");
const dom_ta_shape_input = document.getElementById("ta_shape_input");
const dom_txt_zoom = document.getElementById("txt_zoom");

let canvas;
let shape_pts = [];

dom_btn_submit.onclick = () => {
    shape_pts = [];
    const data = dom_ta_shape_input.value;
    /*
    let last_x = null;
    let last_y = null;
    */

    data.split("\n").forEach((line) => {
        let d = line.split(",");
        while (d.length > 2) { d.splice(0, 1); }
        const x = Number.parseInt(d[0]);
        const y = Number.parseInt(d[1]);
        if (Object.is(x, NaN) || Object.is(y, NaN)) {
            return;
        }
        /*
        if (last_x != null && last_y != null) {
            const dx2 = Math.pow(x - last_x, 2);
            const dy2 = Math.pow(y - last_y, 2);
            if (Math.pow(17, 2) > (dx2 + dy2)) {
                alert("Bad point: ", line);
            }
        }
        last_x = x; last_y = y;
        */
        shape_pts.push([x,y]);
    });
    if (shape_pts.length == 0) {
        return;
    }
    // now format so that the entire thing is contained in the
    // canvas.
    const first_pt = shape_pts[0];
    let xmin = first_pt[0];
    let ymin = first_pt[1];
    let xmax = xmin;
    let ymax = ymin;
    let xavg = 0;
    let yavg = 0;
    shape_pts.forEach(([x,y]) => {
        xmin = min(x, xmin);
        ymin = min(y, ymin);
        xmax = max(x, xmax);
        ymax = max(y, ymax);
        xavg += x;
        yavg += y;
    });
    xavg /= shape_pts.length;
    yavg /= shape_pts.length;
    const width  = xmax - xmin;
    const height = ymax - ymin;
    const xscale = .8 * canvas.width / width;
    const yscale = .8 * canvas.height / height;
    const min_scale = yscale < xscale ? yscale : xscale;
    shape_pts.forEach((pt) => {
        // Add small offset so that the first point is near the
        // edge but not cut off down the middle.
        pt[0] -= xavg;
        pt[1] -= yavg;
        pt[0] *= min_scale;
        pt[1] *= min_scale;
        pt[0] += canvas.width / 2;
        pt[1] += canvas.height / 2;
    });
};

// The statements in the setup() function
// execute once when the program begins
function setup() {
  // createCanvas must be the first statement
  canvas = createCanvas(1000, 1000);
  stroke(255); // Set line drawing color to white
  frameRate(30);
}
// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
function draw() {
  background(0); // Set the background to black

  if (shape_pts.length == 0) {
      return;
  }

  const zoom = Number.parseFloat(dom_txt_zoom.value) || 1.;
  let scaled_pts = [];
  shape_pts.forEach(([x,y]) => { scaled_pts.push([x*zoom, y*zoom]); });

  push();
  fill(color('red'));
  stroke(color('white'));
  for (let i = 1; i < scaled_pts.length; ++i) {
    const [x0, y0] = scaled_pts[i-1];
    const [x1, y1] = scaled_pts[i];
    line(x0, y0, x1, y1);
  }

  for (let i = 0; i < scaled_pts.length; ++i) {
      let r = 4;
      if (i === 0) {
          fill(color("green"));
          r = 8;
      } else {
          fill(color("red"));
      }
      const [x, y] = scaled_pts[i];
      circle(x, y, r);
  }
  fill(color("white"));
  noStroke();
  text('Start', scaled_pts[0][0] + 10, scaled_pts[0][1]);
  pop();
}
