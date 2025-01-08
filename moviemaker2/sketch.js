const videoPlayer = document.getElementById('videoPlayer');
const blurredCanvas = document.getElementById('videoCanvas');
const originalCanvas = document.getElementById('copyCanvas');
const loadButton = document.getElementById('loadButton');
const playPauseButton = document.getElementById('playPauseButton');
let isPlaying = false;

// Ensure video is always muted
videoPlayer.muted = true;

// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const renderer = new THREE.WebGLRenderer({ canvas: blurredCanvas, antialias: true });
const geometry = new THREE.PlaneGeometry(2, 2);
const texture = new THREE.VideoTexture(videoPlayer);

// Screen map variables
let shape_pts = [];
let shapeValid = false;

// Setup for original canvas
const originalContext = originalCanvas.getContext('2d');

// Custom shader material for Gaussian blur
const material = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: texture },
        resolution: { value: new THREE.Vector2() },
        blurRadius: { value: 0 },
        sigma: { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float blurRadius;
        uniform float sigma;
        varying vec2 vUv;

        float gaussianPdf(in float x, in float sigma) {
            return 0.39894 * exp(-0.5 * x * x / (sigma * sigma)) / sigma;
        }

        void main() {
            vec2 invSize = 1.0 / resolution;
            vec3 diffuseSum = vec3(0.0);
            float weightSum = 0.0;

            for (float x = -blurRadius; x <= blurRadius; x++) {
                for (float y = -blurRadius; y <= blurRadius; y++) {
                    vec2 offset = vec2(x, y) * invSize;
                    float weight = gaussianPdf(length(offset) * resolution.x, sigma);
                    diffuseSum += texture2D(tDiffuse, vUv + offset).rgb * weight;
                    weightSum += weight;
                }
            }

            gl_FragColor = vec4(diffuseSum / weightSum, 1.0);
        }
    `
});

const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

// Blur controls
const blurRadiusSlider = document.getElementById('blurRadiusSlider');
const blurRadiusValue = document.getElementById('blurRadiusValue');
const sigmaSlider = document.getElementById('sigmaSlider');
const sigmaValue = document.getElementById('sigmaValue');

blurRadiusSlider.addEventListener('input', updateBlur);
sigmaSlider.addEventListener('input', updateBlur);
blurRadiusValue.addEventListener('input', updateBlurFromValue);
sigmaValue.addEventListener('input', updateBlurFromValue);

function updateBlur() {
    const blurRadius = parseFloat(blurRadiusSlider.value);
    const sigma = parseFloat(sigmaSlider.value);
    material.uniforms.blurRadius.value = blurRadius;
    material.uniforms.sigma.value = sigma;
    blurRadiusValue.value = blurRadius.toFixed(1);
    sigmaValue.value = sigma.toFixed(1);
}

function updateBlurFromValue() {
    blurRadiusSlider.value = blurRadiusValue.value;
    sigmaSlider.value = sigmaValue.value;
    updateBlur();
}

function updateCanvas() {
    // Draw the original video frame on the right canvas
    originalContext.drawImage(videoPlayer, 0, 0, originalCanvas.width, originalCanvas.height);
    
    // Apply blur effect and render on the left canvas
    renderer.render(scene, camera);
    
    requestAnimationFrame(updateCanvas);
}

function resizeCanvas() {
    const containerWidth = window.innerWidth * 0.9; // 90% of window width for both canvases
    const containerHeight = window.innerHeight * 0.8;
    const aspectRatio = videoPlayer.videoWidth / videoPlayer.videoHeight;

    let newWidth, newHeight;

    if (containerWidth / 2 / aspectRatio <= containerHeight) {
        // Width constrained
        newWidth = containerWidth / 2;
        newHeight = newWidth / aspectRatio;
    } else {
        // Height constrained
        newHeight = containerHeight;
        newWidth = newHeight * aspectRatio;
    }

    blurredCanvas.width = newWidth;
    blurredCanvas.height = newHeight;
    originalCanvas.width = newWidth;
    originalCanvas.height = newHeight;

    // Update Three.js renderer size
    renderer.setSize(newWidth, newHeight);

    // Update camera
    camera.left = -1;
    camera.right = 1;
    camera.top = 1 / aspectRatio;
    camera.bottom = -1 / aspectRatio;
    camera.updateProjectionMatrix();

    // Update mesh scale
    mesh.scale.set(1, 1 / aspectRatio, 1);

    // Update resolution uniform for the shader
    material.uniforms.resolution.value.set(newWidth, newHeight);

    // Render the scene
    renderer.render(scene, camera);
}

videoPlayer.addEventListener('loadedmetadata', function() {
    resizeCanvas();
    updateCanvas();
});

window.addEventListener('resize', function() {
    resizeCanvas();
    updateCanvas();
});

loadButton.addEventListener('click', function() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.onchange = function(e) {
        var file = e.target.files[0];
        var fileURL = URL.createObjectURL(file);
        videoPlayer.src = fileURL;
        videoPlayer.onloadedmetadata = function() {
            resizeCanvas();
            playPauseButton.disabled = false;
            playPauseButton.textContent = 'Play';
            isPlaying = false;
        };
    };
    input.click();
});

playPauseButton.addEventListener('click', function() {
    if (isPlaying) {
        videoPlayer.pause();
        this.textContent = 'Play';
    } else {
        videoPlayer.play();
        this.textContent = 'Pause';
    }
    isPlaying = !isPlaying;
});

// Screen map loading functionality
function loadScreenMap() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv';
    input.onchange = function(e) {
        var file = e.target.files[0];
        var reader = new FileReader();
        reader.onload = function(e) {
            loadShapeData(e.target.result);
        };
        reader.readAsText(file);
    };
    input.click();
}

function loadShapeData(data) {
    shape_pts = parseShapeData(data);
    if (shape_pts.length === 0) {
        shapeValid = false;
    } else {
        shape_pts = transformToCenter(shape_pts);
        shapeValid = true;
    }
    updateElementStates();
}

function parseShapeData(text) {
    if (isJsonStr(text)) {
        return parse_shape_data_json(text);
    } else {
        return parseShapeDataCsv(text);
    }
}

function isJsonStr(text) {
    try {
        JSON.parse(text);
        return true;
    } catch (e) {
        return false;
    }
}


function parseShapeDataCsv(text) {
    let out = [];
    const lines = text.split('\n');
    lines.forEach(line => {
        line = line.trim();
        if (line.length === 0) return;
        const parts = line.split(',');
        if (parts.length >= 2) {
            const x = parseFloat(parts[0]);
            const y = parseFloat(parts[1]);
            if (!isNaN(x) && !isNaN(y)) {
                out.push([x, y]);
            }
        }
    });
    return out;
}

function transformToCenter(shape_pts) {
    let out = shape_pts.map(([x, y]) => [x, y]);
    
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    out.forEach(([x, y]) => {
        xmin = Math.min(xmin, x);
        xmax = Math.max(xmax, x);
        ymin = Math.min(ymin, y);
        ymax = Math.max(ymax, y);
    });
    
    let xcenter = (xmin + xmax) / 2;
    let ycenter = (ymin + ymax) / 2;
    let width = xmax - xmin;
    let height = ymax - ymin;
    
    const margin = 20;
    let scaleX = (blurredCanvas.width - 2 * margin) / width;
    let scaleY = (blurredCanvas.height - 2 * margin) / height;
    let scale = Math.min(scaleX, scaleY);
    
    out.forEach((pt) => {
        pt[0] = (pt[0] - xcenter) * scale + blurredCanvas.width / 2;
        pt[1] = (pt[1] - ycenter) * scale + blurredCanvas.height / 2;
    });
    
    return out;
}

function updateElementStates() {
    // Update UI elements based on shape validity
    // This function can be expanded as needed
}

// Add a button for loading the screen map
const loadScreenMapButton = document.createElement('button');
loadScreenMapButton.textContent = 'Load Screen Map';
loadScreenMapButton.addEventListener('click', loadScreenMap);
document.getElementById('controls').appendChild(loadScreenMapButton);
