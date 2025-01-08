const videoPlayer = document.getElementById('videoPlayer');
const videoCanvas = document.getElementById('videoCanvas');
const loadButton = document.getElementById('loadButton');
const playPauseButton = document.getElementById('playPauseButton');
let isPlaying = false;

// Ensure video is always muted
videoPlayer.muted = true;

// Three.js setup
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const renderer = new THREE.WebGLRenderer({ canvas: videoCanvas, antialias: true });
const geometry = new THREE.PlaneGeometry(2, 2);
const texture = new THREE.VideoTexture(videoPlayer);

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

// Add blur controls
const blurControlsContainer = document.createElement('div');
blurControlsContainer.style.marginTop = '10px';
document.body.appendChild(blurControlsContainer);

const blurRadiusLabel = document.createElement('label');
blurRadiusLabel.textContent = 'Blur Radius: ';
blurControlsContainer.appendChild(blurRadiusLabel);

const blurRadiusSlider = document.createElement('input');
blurRadiusSlider.type = 'range';
blurRadiusSlider.min = '0';
blurRadiusSlider.max = '20';
blurRadiusSlider.value = '0';
blurRadiusSlider.step = '1';
blurControlsContainer.appendChild(blurRadiusSlider);

const blurRadiusValue = document.createElement('input');
blurRadiusValue.type = 'number';
blurRadiusValue.min = '0';
blurRadiusValue.max = '20';
blurRadiusValue.value = '0';
blurRadiusValue.step = '1';
blurRadiusValue.style.width = '50px';
blurControlsContainer.appendChild(blurRadiusValue);

blurControlsContainer.appendChild(document.createElement('br'));

const sigmaLabel = document.createElement('label');
sigmaLabel.textContent = 'Sigma: ';
blurControlsContainer.appendChild(sigmaLabel);

const sigmaSlider = document.createElement('input');
sigmaSlider.type = 'range';
sigmaSlider.min = '0.1';
sigmaSlider.max = '10';
sigmaSlider.value = '1';
sigmaSlider.step = '0.1';
blurControlsContainer.appendChild(sigmaSlider);

const sigmaValue = document.createElement('input');
sigmaValue.type = 'number';
sigmaValue.min = '0.1';
sigmaValue.max = '10';
sigmaValue.value = '1';
sigmaValue.step = '0.1';
sigmaValue.style.width = '50px';
blurControlsContainer.appendChild(sigmaValue);

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
    renderer.render(scene, camera);
    requestAnimationFrame(updateCanvas);
}

function resizeCanvas() {
    const aspectRatio = videoPlayer.videoWidth / videoPlayer.videoHeight;
    const maxWidth = window.innerWidth * 0.8;
    const maxHeight = window.innerHeight * 0.8;
    
    let newWidth = maxWidth;
    let newHeight = newWidth / aspectRatio;

    if (newHeight > maxHeight) {
        newHeight = maxHeight;
        newWidth = newHeight * aspectRatio;
    }

    videoCanvas.width = newWidth;
    videoCanvas.height = newHeight;
    
    // Update Three.js renderer size
    renderer.setSize(newWidth, newHeight);
    
    // Update camera to maintain aspect ratio
    const newAspectRatio = newWidth / newHeight;
    camera.left = -newAspectRatio;
    camera.right = newAspectRatio;
    camera.top = 1;
    camera.bottom = -1;
    camera.updateProjectionMatrix();
    
    // Update mesh scale to fit the new aspect ratio
    mesh.scale.set(newAspectRatio, 1, 1);
    
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
