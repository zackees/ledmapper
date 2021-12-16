
const dom_btn_submit = document.getElementById("btn_submit");
const dom_ta_shape_input = document.getElementById("ta_shape_input");
const dom_txt_zoom = document.getElementById("txt_zoom");

let canvas;
let shape_pts = [];

dom_btn_submit.onclick = () => {
    shape_pts = [];
    const data = dom_ta_shape_input.value;
    data.split("\n").forEach((line) => {
        const d = line.split(",");
        const x = Number.parseInt(d[1]);
        const y = Number.parseInt(d[2]);
        if (Object.is(x, NaN) || Object.is(y, NaN)) {
            return;
        }
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
    shape_pts.forEach(([x,y]) => {
        if (x < xmin) { xmin = x; }
        if (y < ymin) { ymin = y; }
    });
    shape_pts.forEach((pt) => {
        pt[0] = pt[0] - xmin;
        pt[1] = pt[1] - ymin;
    });
};

// The statements in the setup() function
// execute once when the program begins
function setup() {
  // createCanvas must be the first statement
  canvas = createCanvas(1000, 1000);
  stroke(255); // Set line drawing color to white
  fill(color('green'));
  frameRate(30);
}
// The statements in draw() are executed until the
// program is stopped. Each statement is executed in
// sequence and after the last line is read, the first
// line is executed again.
function draw() {
  background(0); // Set the background to black

  const zoom = Number.parseFloat(dom_txt_zoom.value) || 1.;
  let scaled_pts = [];
  shape_pts.forEach(([x,y]) => { scaled_pts.push([x*zoom, y*zoom]); });
  scaled_pts.forEach(([x,y]) => { circle(x, y, 4); });
}
