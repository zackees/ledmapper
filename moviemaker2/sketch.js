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
