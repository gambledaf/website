import * as THREE from "https://esm.sh/three@0.129.0";
import { GLTFLoader } from "https://esm.sh/three@0.129.0/examples/jsm/loaders/GLTFLoader.js";
import { RenderPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/RenderPass.js";
import { EffectComposer } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/OutlinePass.js";
import { RectAreaLightUniformsLib } from "https://esm.sh/three@0.129.0/examples/jsm/lights/RectAreaLightUniformsLib.js";
import { RectAreaLightHelper } from "https://esm.sh/three@0.129.0/examples/jsm/helpers/RectAreaLightHelper.js";
import { projectData } from './files.js';


// --- 1. SHARED HELPERS & STATE ---
function getVisibleConfig() {
    let base = Math.floor(window.innerWidth / 240);
    let count = (base % 2 === 0) ? base + 1 : base;
    count = Math.max(5, Math.min(count, 9));
    return { count, radius: (count - 1) / 2 };
}

let cachedConfig = getVisibleConfig();

const { radius: initialRadius } = cachedConfig;

const tapes = [];

const numTapes = projectData.length;
const tapeSpacing = 0.55;

const visibleCount = Math.min(cachedConfig.count, numTapes);
const radius = Math.floor((visibleCount - 1) / 2);

const initialCenter = (numTapes - 1) / 2;

const state = {
    zoom: 0,
    targetZoom: 0,
    currentScroll: initialCenter,
    targetScroll: initialCenter,
    activeTape: null,
    previousTape: null,
    tvOn: true,
    selectedTape: null,
    isLocked: false,
    scrollSpeed: 0.1,
    minDist: 999,
    hoveredInteractable: null,
    // ✅ NEW: scrolling is disabled until tapes finish loading
    scrollingEnabled: false,
    // ✅ NEW: tracks whether the scene has been revealed yet
    sceneRevealed: false
};

const POS_START = { x: 0, y: 0.6, z: -1.5 };
const POS_END   = { x: 0, y: 0.4, z: 5 };

let typingInterval = null;
let fullGoalText = "";
let currentText = "";
let charIndex = 0;

// --- 2. CRT TV INTERNAL SCENE ---
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

const crtShaderMaterial = new THREE.ShaderMaterial({
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

// --- 3. GLOBAL SCENE ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.layers.enable(1);

const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById("bg-canvas"),
    antialias: true,
    alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const hdrRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat
});

const renderPass = new RenderPass(scene, camera);
const composer = new EffectComposer(renderer, hdrRenderTarget);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth * 0.75, window.innerHeight * 0.75),
    2,
    0.5,
    1.2
);
composer.addPass(bloomPass);

const outlinePass = new OutlinePass(
    new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
    scene,
    camera
);
outlinePass.downSampleRatio = 2; 
outlinePass.edgeStrength = 4.0;
outlinePass.edgeGlow = 1.0;
outlinePass.edgeThickness = 2.0;
outlinePass.visibleEdgeColor.set(0x00ff44); 
outlinePass.hiddenEdgeColor.set(0x002200);
composer.addPass(outlinePass);

// Lights   
RectAreaLightUniformsLib.init();
const ambientLight = new THREE.AmbientLight(0x004D4D, 0.2);
scene.add(ambientLight);

const tvTopLight = new THREE.PointLight(0xffffff, 15, 5);
tvTopLight.position.set(0, 5, -7);
tvTopLight.castShadow = true;
tvTopLight.shadow.mapSize.width = 1024;
tvTopLight.shadow.mapSize.height = 1024;
tvTopLight.shadow.bias = -0.0005;
scene.add(tvTopLight);

const tapeLight = new THREE.PointLight(0xffffff, 0.4, 5); 
tapeLight.position.set(0, 0.5, 2);
tapeLight.castShadow = true;
tapeLight.shadow.mapSize.width = 512;
tapeLight.shadow.mapSize.height = 512;
tapeLight.shadow.bias = -0.0005;
scene.add(tapeLight);

const tapeLightRect = new THREE.RectAreaLight(0xffffff, 5, 4, 2);
tapeLightRect.position.set(0, 3, 2);
tapeLightRect.lookAt(0, 0, 0);
scene.add(tapeLightRect);

const sunLight = new THREE.PointLight(0xffffff, 2, 500);
sunLight.position.set(0, 100, -5);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 1024;
sunLight.shadow.mapSize.height = 1024; 
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

const helperVisability = false;

const rectLight = new THREE.RectAreaLight(0x00ff00, 1, 1.75, 1.5);
rectLight.position.set(0, 0.8, -6);
rectLight.lookAt(0, 0.8, 0);
scene.add(rectLight);

const tvRimLight = new THREE.RectAreaLight(0xCFFFD2, 25, 2, 0.5);
tvRimLight.position.set(0, 2.3, -6);
tvRimLight.lookAt(0, 1.5, -7);
scene.add(tvRimLight);
const helper = new RectAreaLightHelper(tvRimLight);  
scene.add(helper);
helper.visible = helperVisability;

const tvRimLight1 = new THREE.RectAreaLight(0x3F755A, 40, 0.5, 1.5);
tvRimLight1.position.set(1.5, 1, -7);
tvRimLight1.lookAt(0, 1, -8);
scene.add(tvRimLight1);
const helper1 = new RectAreaLightHelper(tvRimLight1);  
scene.add(helper1);
helper1.visible = helperVisability;

const tvRimLight2 = new THREE.RectAreaLight(0x3F755A, 40, 0.5, 1.5);
tvRimLight2.position.set(-1.5, 1, -7);
tvRimLight2.lookAt(0, 1, -8);
scene.add(tvRimLight2);
const helper2 = new RectAreaLightHelper(tvRimLight2);  
scene.add(helper2);
helper2.visible = helperVisability;

const tvRimLight3 = new THREE.RectAreaLight(0xCFFFD2, 5, 1, 0.5);
tvRimLight3.position.set(0, 0.5, -6.5);
tvRimLight3.lookAt(0, 0, -7);
scene.add(tvRimLight3);
const helper3 = new RectAreaLightHelper(tvRimLight3);  
scene.add(helper3);
helper3.visible = helperVisability;

const tableRimLight2 = new THREE.RectAreaLight(0x3F755A, 15, 5, 0.25);
tableRimLight2.position.set(0, -0.7, 1);
tableRimLight2.lookAt(0, 1, 0);
scene.add(tableRimLight2);
const helper4 = new RectAreaLightHelper(tableRimLight2);
scene.add(helper4);
helper4.visible = helperVisability;

const tvRimLight5 = new THREE.RectAreaLight(0x00ff00, 15, 0.5, 1.5);
tvRimLight5.position.set(0, 1, -6.5);
tvRimLight5.lookAt(0, 0, -6.5);
scene.add(tvRimLight5);
const helper5 = new RectAreaLightHelper(tvRimLight5);  
scene.add(helper5);
helper5.visible = helperVisability;

// --- 4. SCENE DATA ---
const mouse = new THREE.Vector2(-100, -100);
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();

const tempVec = new THREE.Vector3();
const interactables = [];

let tvModel;
let slideModel = null;
let slideMixer = null;
let slideAction = null;
const blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

// --- 5. LOADING SCREEN ---
const loadingScreen = document.getElementById("loading-screen");
const loadingText = document.getElementById("loading-text");

// ✅ NEW: Track critical assets (TV, table, background, slide) separately from tapes
let criticalLoaded = 0;
const CRITICAL_TOTAL = 4; // tv, table, background, slide

function onCriticalAssetLoaded() {
    criticalLoaded++;
    const progress = Math.floor((criticalLoaded / CRITICAL_TOTAL) * 100);
    if (loadingText) loadingText.innerText = `LOADING... ${progress}%`;

    if (criticalLoaded === CRITICAL_TOTAL) {
        revealScene();
    }
}

// ✅ NEW: Reveal the scene as soon as critical assets are ready
// Tapes may still be loading in the background at this point
function revealScene() {
    if (state.sceneRevealed) return;
    state.sceneRevealed = true;

    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const returnIndex = localStorage.getItem('returnTapeIndex');

    // Pre-position camera
    camera.position.set(POS_START.x, POS_START.y, POS_START.z);
    camera.lookAt(0, 0.8, -10);

    // Start the render loop NOW — tapes will pop in as they load
    animate();

    if (returnIndex !== null) {
        // --- EJECT & RETURN PATH ---
        try {
            localStorage.removeItem('returnTapeIndex');
        } catch(e) {}

        loadingScreen.style.display = "none";
        document.body.style.opacity = "1";

        const tapeId = parseInt(returnIndex);
        state.currentScroll = tapeId;
        state.targetScroll = tapeId;
        cachedConfig = getVisibleConfig();

        state.zoom = 1;
        state.targetZoom = 1;
        camera.position.set(POS_END.x, POS_END.y, POS_END.z);
        camera.lookAt(0, 0.8, -10);

        if (!state.tvOn) toggleTVPower();
        typeSentence("PROJECT EJECTED.\n\nRETURNING TO ARCHIVE...");

        // Delay the eject animation — tapes might still be loading
        setTimeout(() => {
            const tapeToEject = tapes[tapeId];
            if (tapeToEject) {
                const flip = tapeToEject.userData.action2;
                if (flip) {
                    flip.reset();
                    flip.time = flip.getClip().duration; 
                    flip.timeScale = -1; 
                    flip.play();
                }
            }
            state.targetZoom = 0; 
        }, 800);

    } else if (action) {
        // --- NAVBAR CLICK PATH ---
        loadingScreen.style.display = "none";
        document.body.style.opacity = "1";

        if (action === "projects" || action === "home") {
            state.zoom = 0;
            state.targetZoom = 0;
            camera.position.set(POS_START.x, POS_START.y, POS_START.z);
        } else {
            state.zoom = 1;
            state.targetZoom = 1;
            camera.position.set(POS_END.x, POS_END.y, POS_END.z);
        }
        camera.lookAt(0, 0.8, -10);

        window.history.replaceState({}, document.title, window.location.pathname);
        handleSystemAction(action);

    } else {
        // --- NORMAL FIRST-TIME LOAD ---
        // Fade out loading screen and show the scene immediately
        loadingScreen.style.opacity = "0";
        setTimeout(() => {
            loadingScreen.style.display = "none";
            document.body.style.opacity = "1";
            typeSentence("SYSTEM ONLINE.\n\nLOADING ARCHIVE...");
        }, 500);
    }
}

// ✅ NEW: Called when tapes finish loading — enable scrolling and update CRT text
function onTapesLoaded() {
    state.scrollingEnabled = true;

    // Only update the CRT text if we're in the normal load path (not returning/navbar)
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');
    const returnIndex = localStorage.getItem('returnTapeIndex');

    if (!action && returnIndex === null) {
        // Small delay so it doesn't interrupt the "SYSTEM ONLINE" typing
        setTimeout(() => {
            typeSentence("ARCHIVE READY.\n\nSCROLL TO BROWSE.");
        }, 2000);
    } else {
        // For navbar/return paths, just silently enable scrolling
        state.scrollingEnabled = true;
    }
}


// --- 6. LOAD MODELS ---
// ✅ CHANGED: Use a plain GLTFLoader — no loadingManager
// Critical assets (TV, table, background, slide) call onCriticalAssetLoaded()
// Tapes load independently and call onTapesLoaded() when done
const loader = new GLTFLoader();

loader.load("models/slide.glb", gltf => {
    slideModel = gltf.scene;
    slideModel.position.set(0, 0, 0);
    slideMixer = new THREE.AnimationMixer(slideModel);

    if (gltf.animations[0]) {
        slideAction = slideMixer.clipAction(gltf.animations[0]);
        slideAction.setLoop(THREE.LoopOnce);
        slideAction.clampWhenFinished = true;
    }

    slideModel.traverse(c => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            if (c.material) c.material.roughness = 0.85;
        }
    });

    slideModel.scale.set(0.0001, 0.0001, 0.0001);
    scene.add(slideModel);

    // ✅ Slide counts as a critical asset
    onCriticalAssetLoaded();
});

loader.load("models/tv.glb", gltf => {
    tvModel = gltf.scene;
    tvModel.position.set(0, 0, 0);

    tvModel.traverse(c => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;

            if (c.name === "screen") {
                c.material = crtShaderMaterial;
            } else {
                const mat = c.material;

                if (mat.map) {
                    mat.map.colorSpace = THREE.SRGBColorSpace;
                }

                mat.roughness = 1.0;
                mat.metalness = 0.0;
                
                if (mat.normalMap) {
                    mat.normalScale.set(1, 1); 
                }

                const name = (c.name || "").toLowerCase();
                if (name.includes("button")) {
                    c.material = mat.clone();
                    c.userData.isInteractable = true;
                    c.userData.origEmissive = c.material.emissive.getHex();
                    interactables.push(c);
                }
            }
        }
    });

    scene.add(tvModel);

    // ✅ TV is critical
    onCriticalAssetLoaded();
});

loader.load('models/background.glb', (gltf) => {
    const backdrop = gltf.scene;
    
    backdrop.traverse((node) => {
        if (node.isMesh && node.name === "background") {
            node.material.emissiveIntensity = 1.0; 
            node.material.depthWrite = false;
            node.material.depthTest = true;
            
            if (node.material.map) {
                node.material.map.colorSpace = THREE.SRGBColorSpace;
            }
        }
    });

    backdrop.position.set(0, 0, -100);
    backdrop.renderOrder = -100;

    scene.add(backdrop);

    // ✅ Background is critical
    onCriticalAssetLoaded();
});

loader.load("models/table.glb", gltf => {
    const table = gltf.scene;
    table.name = "table";
    table.position.set(0, -0.3, -5); 
    table.scale.set(1, 1, 1);

    table.traverse(c => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
            c.material.roughness = 0.5;
            c.material.metalness = 0;
        }
    });

    scene.add(table);

    // ✅ Table is critical
    onCriticalAssetLoaded();
});

// ✅ TAPES: Loaded independently — do NOT block the scene reveal
loader.load("models/tape.glb", gltf => {
    for (let i = 0; i < numTapes; i++) {
        const tape = gltf.scene.clone();
        const mixer = new THREE.AnimationMixer(tape);

        let action1 = null;
        let action2 = null;

        if (gltf.animations[1]) {
            action1 = mixer.clipAction(gltf.animations[1]);
            action1.setLoop(THREE.LoopOnce);
            action1.clampWhenFinished = true;
            action1.timeScale = 1.0;
        }
        if (gltf.animations[0]) {
            action2 = mixer.clipAction(gltf.animations[0]);
            action2.setLoop(THREE.LoopOnce);
            action2.clampWhenFinished = true;
            action2.timeScale = 1.0;
        }

        tape.scale.set(1, 1, 1);
        tape.position.set(0, 0.4, 0);

        tape.userData = {
            index: i,
            mixer: mixer,
            action1: action1,
            action2: action2,
            projectInfo: projectData[i]
        };

        tape.traverse(c => {
            if (c.isMesh) {
                c.frustumCulled = false;
                c.castShadow = true;
            }
        });

        scene.add(tape);
        tapes.push(tape);
    }

    // ✅ All tapes are in — enable scrolling
    onTapesLoaded();
});

// --- BACKGROUND RETRO GRID ---
const gridSize = 60;
const gridDivisions = 60;
const gridColor = 0xaaaaaa;

const bgGrid = new THREE.GridHelper(gridSize, gridDivisions, gridColor, gridColor);
bgGrid.rotation.x = Math.PI / 2;
bgGrid.position.set(0, 0, -15); 
bgGrid.material.transparent = true;
bgGrid.material.opacity = 0.15; 
bgGrid.material.color.setHex(0xffffff); 
scene.add(bgGrid);

// --- 7. LOGIC & TEXT ---
function toggleTVPower() {
    state.tvOn = !state.tvOn;
    // ✅ Guard against tvModel being null
    if (!tvModel) return;
    tvModel.traverse(c => {
        if (c.isMesh && c.name === "screen") c.material = state.tvOn ? crtShaderMaterial : blackMaterial;
    });
}

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

function typeSentence(sentence) {
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

// --- 8. EVENTS ---
window.addEventListener("mousemove", e => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

let scrollCooldown = false;
const SCROLL_DELAY = 50;

window.addEventListener("wheel", e => {
    // ✅ Block scrolling until tapes are loaded
    if (!state.scrollingEnabled) return;
    if (scrollCooldown) return;

    const { radius } = cachedConfig;

    if (e.deltaY > 5) {
        if (state.targetZoom < 1) {
            state.targetZoom = 1;
            triggerCooldown();
        } else if (state.targetScroll < numTapes - 1 - radius) {
            state.targetScroll++;
            triggerCooldown();
        }
    } else if (e.deltaY < -5) {
        if (state.targetScroll > radius) {
            state.targetScroll--;
            triggerCooldown();
        } else {
            state.targetZoom = 0;
            triggerCooldown();
        }
    }
});

function triggerCooldown() {
    scrollCooldown = true;
    setTimeout(() => { scrollCooldown = false; }, SCROLL_DELAY);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);

    cachedConfig = getVisibleConfig();
    const { radius } = cachedConfig;
    state.targetScroll = THREE.MathUtils.clamp(state.targetScroll, radius, numTapes - 1 - radius);
    outlinePass.resolution.set(window.innerWidth * 0.5, window.innerHeight * 0.5);
});

window.addEventListener('click', () => {

    console.log("Mouse Coords:", mouse.x.toFixed(2), mouse.y.toFixed(2));
    console.log("Total Buttons Loaded:", interactables.length);
    
    raycaster.setFromCamera(mouse, camera);
    
    const buttonHits = raycaster.intersectObjects(interactables, false);
    console.log("Button Hits:", buttonHits.length);

    const visibleTapes = tapes.filter(t => t.visible);
    const tapeHits = raycaster.intersectObjects(visibleTapes, true);
    console.log("Tape Hits:", tapeHits.length);

    if (state.zoom > 0.9 && state.activeTape && !state.isLocked) {
        // ✅ Guard: only allow tape selection if tapes are fully loaded
        if (!state.scrollingEnabled) return;

        state.isLocked = true;
        state.scrollSpeed = 0.03;
        state.selectedTape = state.activeTape;
        state.targetScroll = state.activeTape.userData.index;

        setTimeout(() => {
            const projectData = state.selectedTape.userData.projectInfo;
            openProjectPage(projectData);
        }, 1500);
        
        const hov = state.selectedTape.userData.action1;
        const flip = state.selectedTape.userData.action2;

        setTimeout(() => {
            if (flip) {
                if (hov) hov.stop();

                flip.reset();
                flip.setEffectiveWeight(1.0);
                flip.play();

                typeSentence("LOADING PROJECT...");

                setTimeout(() => {
                    if (slideModel && slideAction) {
                        slideModel.scale.set(1, 1, 1);
                        slideAction.reset();
                        slideAction.play();
                    }
                }, 600);

                setTimeout(() => { state.targetZoom = 0; }, 500);
            }
        }, 400);

        return;
    }

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(interactables, false);

    if (intersects.length > 0) {
        const obj = intersects[0].object;
        const name = obj.name.toLowerCase();

        if (name.includes("button")) {
            obj.position.y -= 0.02; 
            setTimeout(() => obj.position.y += 0.02, 100);

            if (name.includes("01")) handleSystemAction("power");
            if (name.includes("02")) handleSystemAction("home");
            if (name.includes("03")) handleSystemAction("about");
            if (name.includes("04")) handleSystemAction("projects");
            if (name.includes("05")) handleSystemAction("contact");
        }
    }
});

// --- THE MASTER CONTROLLER ---
function handleSystemAction(action) {
    if (state.isLocked) {
        const hud = document.getElementById('project-hud');
        if (hud) hud.classList.remove('active');
        
        if (state.selectedTape) {
            const flip = state.selectedTape.userData.action2;
            if (flip) {
                flip.paused = false;
                flip.timeScale = -1;
                flip.play();
            }
        }
        state.isLocked = false;
        state.selectedTape = null;
        state.scrollSpeed = 0.1; 
    }

    switch (action) {
        case "power":
            toggleTVPower();
            break;

        case "home":
            state.targetZoom = 0;
            if (!state.tvOn) toggleTVPower();
            typeSentence("SYSTEM HOME...\n\nWELCOME TO THE ARCHIVE.");
            break;

        case "about":
            state.targetZoom = 0;
            if (!state.tvOn) toggleTVPower();
            typeSentence("ABOUT SYSTEM...\n\nI AM A 3D DEVELOPER\nBUILDING INTERACTIVE WORLDS.");
            break;

        case "projects":
            state.targetZoom = 1;
            if (!state.tvOn) toggleTVPower();
            // ✅ Different message depending on whether tapes are ready
            typeSentence(
                state.scrollingEnabled
                    ? "PROJECT ARCHIVE...\n\nSELECT A TAPE BELOW."
                    : "PROJECT ARCHIVE...\n\nLOADING TAPES..."
            );
            break;

        case "contact":
            state.targetZoom = 0;
            if (!state.tvOn) toggleTVPower();
            typeSentence("CONTACT PROTOCOL...\n\nEMAIL: hello@portfolio.com\nSIGNAL: SECURE");
            break;
    }
}

function triggerTVMenu(text) {
    if (state.targetZoom < 1) {
        state.targetZoom = 1;
        setTimeout(() => {
            if (!state.tvOn) toggleTVPower();
            typeSentence(text);
        }, 800); 
    } else {
        if (!state.tvOn) toggleTVPower();
        typeSentence(text);
    }
}

// --- PROJECT PAGE HANDLER ---
function openProjectPage(data) {
    if (data && data.url) {
        document.body.style.transition = "opacity 0.5s ease";
        document.body.style.opacity = "0";

        setTimeout(() => {
            window.location.href = data.url;
        }, 500); 

    } else {
        console.warn("Missing URL in files.js for project:", data?.title);
        typeSentence("ERROR: FILE CORRUPTED.\n\nNO URL FOUND.");
    }
}

// --- 9. ANIMATE ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    state.zoom = THREE.MathUtils.lerp(state.zoom, state.targetZoom, 0.06);

    if (slideMixer) slideMixer.update(delta);

    state.currentScroll = THREE.MathUtils.lerp(state.currentScroll, state.targetScroll, state.scrollSpeed);

    const { radius } = cachedConfig;
    const center = Math.round(state.currentScroll);

    let currentFrameActiveTape = null;
    let currentFrameMinDist = 999;

    tapes.forEach((tape, i) => {
        // ✅ Guard against partially-initialised tape slots
        if (!tape) return;

        tape.visible = i >= center - radius && i <= center + radius;

        if (tape.visible && tape.userData.mixer) tape.userData.mixer.update(delta);
        if (!tape.visible) return;

        tape.position.x = (i - state.currentScroll) * tapeSpacing;

        if (state.zoom > 0.9) {
            tape.getWorldPosition(tempVec);
            tempVec.project(camera);

            const distX = Math.abs(mouse.x - tempVec.x);
            const distY = Math.abs(mouse.y - tempVec.y);

            if (distY < 0.4 && distX < currentFrameMinDist) {
                currentFrameMinDist = distX;
                currentFrameActiveTape = tape;
            }
        }
    });

    state.activeTape = (currentFrameMinDist < 0.1) ? currentFrameActiveTape : null;
    state.minDist = currentFrameMinDist;

    const tapeToOutline = state.selectedTape || state.activeTape;

    if (tapeToOutline) {
        outlinePass.selectedObjects = [tapeToOutline];
    } else {
        outlinePass.selectedObjects = [];
    }

    if (!state.isLocked && state.activeTape !== state.previousTape) {
        const hoverUI = document.getElementById('tape-hover-ui');
        if (state.previousTape?.userData.action1) {
            const hov = state.previousTape.userData.action1;
            hov.paused = false;
            hov.timeScale = -1;
            hov.play();

            hoverUI.classList.remove('visible');
        }
        if (state.activeTape?.userData.action1) {
            const hov = state.activeTape.userData.action1;
            hov.paused = false;
            hov.timeScale = 1;
            hov.play();
            const data = state.activeTape.userData.projectInfo;
            if (data) {
                document.getElementById('hover-category').innerText = data.category ? data.category.toUpperCase() : "SYSTEM FILE";
                document.getElementById('hover-title').innerText = data.title ? data.title.toUpperCase() : "UNKNOWN_DATA";
                document.getElementById('hover-desc').innerText = data.shortDesc ? data.shortDesc : "";
                
                hoverUI.classList.add('visible');
            }
        }
        state.previousTape = state.activeTape;
    }

    if (state.tvOn) {
        crtShaderMaterial.uniforms.uTime.value += 0.01;
        renderer.setRenderTarget(renderTarget);
        renderer.render(tvScene, tvCamera);
        renderer.setRenderTarget(null);
    }

    const targetX = THREE.MathUtils.lerp(POS_START.x, POS_END.x, state.zoom);
    const targetY = THREE.MathUtils.lerp(POS_START.y, POS_END.y, state.zoom);
    const targetZ = THREE.MathUtils.lerp(POS_START.z, POS_END.z, state.zoom);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.04);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.04);
    camera.lookAt(0, 0.8, -10);

    if (!state.isLocked) {
        let cursorStyle = "default";
        let currentHitObj = null;

        if (state.zoom < 0.5) {
            raycaster.setFromCamera(mouse, camera);
            const intersects = raycaster.intersectObjects(interactables, false);
            for (let i = 0; i < intersects.length; i++) {
                if (intersects[i].object.userData?.isInteractable) {
                    cursorStyle = "pointer";
                    currentHitObj = intersects[i].object;
                    break;
                }
            }
        } else if (state.zoom > 0.9 && state.activeTape) {
            cursorStyle = "pointer";
        }

        document.body.style.cursor = cursorStyle;

        if (currentHitObj !== state.hoveredInteractable) {
            if (state.hoveredInteractable?.material) {
                state.hoveredInteractable.material.emissive.setHex(state.hoveredInteractable.userData.origEmissive);
            }
            if (currentHitObj?.material) {
                currentHitObj.material.emissive.setHex(0x333333);
            }
            state.hoveredInteractable = currentHitObj;
        }
    }

    composer.render();
}

// ✅ NOTE: animate() is no longer called here at the bottom.
// It is called inside revealScene() once critical assets are ready.