
const dom_btn_upload_shape = document.getElementById("btn_upload_shape");
const dom_txt_zoom = document.getElementById("txt_zoom");

let canvas;
let shape_pts = [];
let minX, minY, maxX, maxY;

function load_shape_data(text) {
    shape_pts = parse_shape_data(text);
    if (shape_pts.length == 0) {
        return;
    }
    calculateBounds();
    shape_pts = transform_to_center_of_canvas(shape_pts, canvas.width, canvas.height);
}

function calculateBounds() {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    
    shape_pts.forEach(([x, y]) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    });
}

dom_btn_upload_shape.onchange = (evt) => {
    const file = dom_btn_upload_shape.files[0];
    const reader = new FileReader();
    reader.onload = (evt) => { load_shape_data(evt.target.result); };
    reader.readAsText(file);
};

function setup() {
    canvas = createCanvas(windowWidth * 0.9, windowHeight * 0.8);
    canvas.parent('main');
    strokeWeight(2);
    frameRate(60);
}

function draw() {
    background(18, 18, 18);

    if (shape_pts.length == 0) {
        fill(255);
        textAlign(CENTER, CENTER);
        textSize(24);
        text("Upload a shape file to begin", width / 2, height / 2);
        return;
    }

    const zoom = Number.parseFloat(dom_txt_zoom.value) || 1;
    let scaled_pts = [];
    shape_pts.forEach(([x,y]) => { scaled_pts.push([x*zoom, y*zoom]); });

    push();
    translate(width / 2, height / 2);
    
    // Draw grid
    stroke(50);
    strokeWeight(0.5);
    for (let x = -width; x < width; x += 50) {
        line(x, -height, x, height);
    }
    for (let y = -height; y < height; y += 50) {
        line(-width, y, width, y);
    }
    
    // Draw shape
    noFill();
    stroke(33, 150, 243);
    beginShape();
    scaled_pts.forEach(([x, y]) => {
        vertex(x, y);
    });
    endShape(CLOSE);

    // Draw points
    for (let i = 0; i < scaled_pts.length; ++i) {
        let r = 6;
        if (i === 0) {
            fill(76, 175, 80);
            r = 10;
        } else {
            fill(244, 67, 54);
        }
        const [x, y] = scaled_pts[i];
        circle(x, y, r);
    }
    
    // Draw labels
    fill(255);
    noStroke();
    textAlign(LEFT, CENTER);
    textSize(14);
    text('Start', scaled_pts[0][0] + 15, scaled_pts[0][1]);
    
    pop();
    
    // Draw info
    fill(255);
    textAlign(LEFT, TOP);
    textSize(14);
    text(`Points: ${shape_pts.length}`, 10, 10);
    text(`Bounds: (${minX.toFixed(2)}, ${minY.toFixed(2)}) to (${maxX.toFixed(2)}, ${maxY.toFixed(2)})`, 10, 30);
}

function windowResized() {
    resizeCanvas(windowWidth * 0.9, windowHeight * 0.8);
}
