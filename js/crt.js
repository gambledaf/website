// js/crt.js
import * as THREE from "https://esm.sh/three@0.129.0";

// --- 1. INTERNAL CRT SCENE ---
const renderTarget = new THREE.WebGLRenderTarget(512, 512);
const tvScene = new THREE.Scene();
const tvCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
tvCamera.position.z = 5;

const textCanvas = document.createElement("canvas");
textCanvas.width = textCanvas.height = 512;
const ctx = textCanvas.getContext("2d");

const textTexture = new THREE.CanvasTexture(textCanvas);
textTexture.center.set(0.5, 0.5);
textTexture.flipY = false;

const textMaterial = new THREE.MeshBasicMaterial({ map: textTexture, transparent: true });
const textPlane = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), textMaterial);
tvScene.add(textPlane);

// --- 2. EXPORTED SHADER MATERIAL ---
export const crtShaderMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: renderTarget.texture },
        uTime: { value: 0 }
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
        uniform float uTime; 
        varying vec2 vUv;
        void main() {
            vec2 uv = vUv;
            vec4 tex = texture2D(tDiffuse, uv);
            float movingLines = fract(uv.y * 25.0 - uTime * 0.8);
            float scanline = step(0.1, movingLines);
            vec3 finalColor = tex.rgb * scanline;
            gl_FragColor = vec4(finalColor * 2.5, 2.5);
        }
    `
});

// --- 3. TYPING LOGIC ---
let typingInterval = null;
let fullGoalText = "";
let currentText = "";
let charIndex = 0;

function updateTextCanvas() {
    ctx.clearRect(0, 0, 512, 512);
    ctx.fillStyle = "#00ff00";
    ctx.font = "bold 20px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const startX = 30; 
    let currentY = 30; 
    const lineHeight = 40; 
    const maxWidth = 452; 

    const textToDraw = currentText + (charIndex < fullGoalText.length ? "█" : "");
    const lines = textToDraw.split('\n');

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        let printLine = "";
        for(let j = 0; j < line.length; j++) {
            let testLine = printLine + line[j];
            if(ctx.measureText(testLine).width > maxWidth) {
                ctx.fillText(printLine, startX, currentY); 
                printLine = line[j]; 
                currentY += lineHeight; 
            } else {
                printLine = testLine; 
            }
        }
        ctx.fillText(printLine, startX, currentY);
        currentY += lineHeight;
    }
    textTexture.needsUpdate = true;
}

export function setScreenTextInstant(text) {
    fullGoalText = text;
    currentText = text;
    charIndex = fullGoalText.length;
    clearInterval(typingInterval);
    updateTextCanvas();
}

// Export this so main.js can tell the TV what to type
export function typeSentence(sentence) {
    fullGoalText = sentence;
    currentText = "";
    charIndex = 0;
    clearInterval(typingInterval);

    typingInterval = setInterval(() => {
        if (charIndex < fullGoalText.length) {
            currentText += fullGoalText[charIndex++];
            updateTextCanvas();
        } else clearInterval(typingInterval);
    }, 50);
}

// Export this so the main animation loop can render the TV
export function renderCRT(renderer) {
    crtShaderMaterial.uniforms.uTime.value += 0.01;
    renderer.setRenderTarget(renderTarget);
    renderer.render(tvScene, tvCamera);
    renderer.setRenderTarget(null);
}