
const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_txt_zoom = document.getElementById("txt_zoom");

let canvas;
let shape_pts = [];


function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    if (shape_pts.length == 0) {
        return;
    }
    shape_pts = transform_to_center_of_canvas(shape_pts, canvas.width, canvas.height);
}

dom_btn_upload_shape.onchange = (evt) => {
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => { load_shape_data(evt.target.result); };
    reader.readAsText(file);
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
