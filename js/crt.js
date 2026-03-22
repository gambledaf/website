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
            // 1. THE CRT BULGE (Warping the screen shape)
            vec2 uv = vUv;
            uv -= 0.5; // Shift to center
            float rsq = uv.x * uv.x + uv.y * uv.y; // Distance squared
            uv += uv * rsq * 0.15; // Multiply by bulge strength
            uv += 0.5; // Shift back

            // If the bulge pushes coordinates off the edge, render pure black bezel shadow
            if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
                gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                return;
            }

            // 2. THE BASE SCREEN COLOR (Greyish-green tube)
            vec3 baseColor = vec3(0.15, 0.18, 0.15); 

            // 3. THE VIGNETTE (Darker corners for depth)
            float dist = distance(vUv, vec2(0.5, 0.5));
            float vignette = smoothstep(0.8, 0.2, dist); 
            baseColor *= vignette;

            // 4. THE GLOWING TEXT
            vec4 tex = texture2D(tDiffuse, uv);
            vec3 textColor = tex.rgb * vec3(0.2, 1.0, 0.2); // Neon green glow

            // 5. FINAL MIX (Scanlines removed!)
            // Just combine the dusty base color with the bright text
            vec3 finalColor = baseColor + (textColor * 2.0);

            // Add a tiny bit of screen flicker so it still feels alive
            float flicker = 0.98 + 0.03 * sin(uTime * 15.0);
            finalColor *= flicker;

            gl_FragColor = vec4(finalColor, 1.0);
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