import * as THREE from "https://esm.sh/three@0.129.0";
import { GLTFLoader } from "https://esm.sh/three@0.129.0/examples/jsm/loaders/GLTFLoader.js";
import { RenderPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/RenderPass.js";
import { EffectComposer } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/OutlinePass.js";
import { setupSceneLights } from './js/lights.js';
import { projectData } from './js/files.js';

// --- 1. SHARED HELPERS & STATE ---
function getVisibleConfig() {
    let base = Math.floor(window.innerWidth / 240);
    let count = (base % 2 === 0) ? base + 1 : base;
    count = Math.max(5, Math.min(count, 9));
    return { count, radius: (count - 1) / 2 };
}

let cachedConfig = getVisibleConfig();
const tapes = [];

const numTapes = projectData.length;
const tapeSpacing = 0.55;
const initialCenter = numTapes > 0 ? Math.min(cachedConfig.radius, (numTapes - 1) / 2) : 0;

const state = {
    zoom: 0,
    targetZoom: 0,
    currentScroll: initialCenter,
    targetScroll: initialCenter,
    activeTape: null,
    previousTape: null,
    selectedTape: null,
    isLocked: false,
    scrollSpeed: 0.1,
    minDist: 999
};

const POS_START = { x: 0, y: 0.6, z: -1.5 };
const POS_END   = { x: 0, y: 0.4, z: 5 };
const TAPE_HIGHLIGHT = {
    dimOthers: 0.45,
    colorLift: 0.35,
    colorLerp: 0.2,
    emissiveBoost: 0.28,
    emissiveLerp: 0.18
};
const TAPE_HIGHLIGHT_COLOR = new THREE.Color(0xffffff);
const TAPE_TMP_COLOR = new THREE.Color();


// --- 2. SEQUENCE BACKGROUND SETUP ---
const SEQUENCE = {
    folder: 'sequence_01',
    start: 1,
    end: 100,
    pad: 4,
    ext: 'jpg',
    total: 100
};

const SEQUENCE_2 = {
    folder: 'sequence_02',
    start: 1,
    end: 30,
    pad: 4,
    ext: 'jpg',
    total: 30
};

const ABOUT_SEQUENCE = {
    folder: 'about',
    start: 1,
    end: 30,
    pad: 4,
    ext: 'jpg',
    total: 30
};

const CONTACT_SEQUENCE = {
    folder: 'contact',
    start: 1,
    end: 30,
    pad: 4,
    ext: 'jpg',
    total: 30
};

const SEQUENCE_BLEND = {
    zoomStart: 0.72,
    zoomFull: 0.92,
    radiusNdc: 0.18,
    softness: 0.72,
    maxAlpha: 0.95
};

const SEQUENCE_TIMELINE = {
    fps: 60,
    loopEndFrame: 30,
    animEndFrame: 70,
    zoomedLoopEndFrame: 100
};

const seqCanvas = document.getElementById('sequence-canvas');
const seqCtx = seqCanvas ? seqCanvas.getContext('2d') : null;
const sequenceCache = new Map();
const sequence2Cache = new Map();
const aboutSequenceCache = new Map();
const contactSequenceCache = new Map();
const sequenceCachesByKey = {
    default: sequenceCache,
    about: aboutSequenceCache,
    contact: contactSequenceCache
};
const sequenceConfigByKey = {
    default: SEQUENCE,
    about: ABOUT_SEQUENCE,
    contact: CONTACT_SEQUENCE
};
const sequencePreloadState = {
    default: false,
    about: false,
    contact: false
};
let activeSequenceKey = 'default';
let sequenceLoadedCount = 0;
let sequenceErrorCount = 0;
let sequenceTimelineFrame = 0;
let pendingSectionSequenceKey = null;
let sequence2Preloaded = false;
let lastDrawnSequenceKey = null;
let lastDrawnFrame = -1;
const blendCanvas = document.createElement('canvas');
const blendCtx = blendCanvas.getContext('2d');

function getLoopBoundaryFrame() {
    return THREE.MathUtils.clamp(
        SEQUENCE_TIMELINE.loopEndFrame,
        0,
        Math.max(0, SEQUENCE_TIMELINE.animEndFrame - 1)
    );
}

function renderSequenceFromTimeline(timelineFrame) {
    let progress = 0;

    if (activeSequenceKey === 'default') {
        // The default sequence uses the full 100-frame zoom track
        const normalized = THREE.MathUtils.clamp(timelineFrame, 0, SEQUENCE_TIMELINE.zoomedLoopEndFrame);
        progress = normalized / SEQUENCE_TIMELINE.zoomedLoopEndFrame;
    } else {
        // About & Contact are only 30 frames. We stretch the 0-30 timeline to equal 0-100% progress.
        const loopMax = getLoopBoundaryFrame(); // This equals 30
        const normalized = THREE.MathUtils.clamp(timelineFrame, 0, loopMax);
        progress = normalized / loopMax;
    }

    drawSequence(progress);
}

function getNearestLoadedFrame(cache, sequenceConfig, targetFrame) {
    if (cache.has(targetFrame)) return cache.get(targetFrame);

    for (let offset = 1; offset < sequenceConfig.total; offset++) {
        const backward = targetFrame - offset;
        if (backward >= sequenceConfig.start && cache.has(backward)) {
            return cache.get(backward);
        }

        const forward = targetFrame + offset;
        if (forward <= sequenceConfig.end && cache.has(forward)) {
            return cache.get(forward);
        }
    }

    return null;
}

function getSequenceFramePath(sequenceConfig, frameNumber) {
    const padded = String(frameNumber).padStart(sequenceConfig.pad, '0');
    return `${sequenceConfig.folder}/${padded}.${sequenceConfig.ext}`;
}

function preloadSequenceByKey(sequenceKey, shouldTrackBootProgress = false) {
    if (sequencePreloadState[sequenceKey]) return;

    const sequenceConfig = sequenceConfigByKey[sequenceKey];
    const cache = sequenceCachesByKey[sequenceKey];
    if (!sequenceConfig || !cache) return;

    sequencePreloadState[sequenceKey] = true;

    for (let i = sequenceConfig.start; i <= sequenceConfig.end; i++) {
        const img = new Image();
        img.src = getSequenceFramePath(sequenceConfig, i);
        img.onload = () => {
            cache.set(i, img);
            if (shouldTrackBootProgress) {
                sequenceLoadedCount++;
                sequenceProgress = (sequenceLoadedCount + sequenceErrorCount) / SEQUENCE.total;
                updateLoadProgress();
            }
            if (sequenceKey === activeSequenceKey && i === sequenceConfig.start) drawSequence(0);
        };
        img.onerror = () => {
            if (shouldTrackBootProgress) {
                sequenceErrorCount++;
                sequenceProgress = (sequenceLoadedCount + sequenceErrorCount) / SEQUENCE.total;
                updateLoadProgress();
            }
            console.error(`ERROR: Failed to load sequence frame ${getSequenceFramePath(sequenceConfig, i)}`);
        };
    }
}

function preloadSequence2() {
    if (sequence2Preloaded) return;
    sequence2Preloaded = true;

    for (let i = SEQUENCE_2.start; i <= SEQUENCE_2.end; i++) {
        const img = new Image();
        img.src = getSequenceFramePath(SEQUENCE_2, i);
        img.onload = () => {
            sequence2Cache.set(i, img);
        };
        img.onerror = () => {
            console.error(`ERROR: Failed to load sequence_02 frame ${getSequenceFramePath(SEQUENCE_2, i)}`);
        };
    }
}

function getSequence2BlendAlpha() {
    if (activeSequenceKey !== 'default') return 0;

    if (!sequence2Preloaded) {
        preloadSequence2();
    }

    const cameraTravel = THREE.MathUtils.clamp(
        (camera.position.z - POS_START.z) / (POS_END.z - POS_START.z),
        0,
        1
    );

    // Performance gate: only run the feather effect at a single settled endpoint,
    // not during zoom scrubbing or transitions.
    const isSettled = Math.abs(state.zoom - state.targetZoom) < 0.015;
    const isAtChosenEndpoint = cameraTravel <= 0.06;
    if (!isSettled || !isAtChosenEndpoint) return 0;

    const zoomNearTV = 1 - THREE.MathUtils.clamp(state.zoom, 0, 1);
    const travelNearTV = 1 - cameraTravel;

    const zoomInfluence = THREE.MathUtils.smoothstep(zoomNearTV, SEQUENCE_BLEND.zoomStart, SEQUENCE_BLEND.zoomFull);
    const cameraInfluence = THREE.MathUtils.smoothstep(travelNearTV, 0.82, 0.97);

    return zoomInfluence * cameraInfluence;
}

function drawSequence(progress) {
    if (!seqCtx) return;
    const activeSequenceConfig = sequenceConfigByKey[activeSequenceKey] || SEQUENCE;
    const activeCache = sequenceCachesByKey[activeSequenceKey] || sequenceCache;
    
    // Clamp progress between 0 and 1 just in case
    progress = Math.max(0, Math.min(1, progress));
    const frameIndex = Math.floor(progress * (activeSequenceConfig.total - 1));
    const targetFrame = activeSequenceConfig.start + frameIndex;
    const blendAlpha = getSequence2BlendAlpha();
    const hasBlendWork = blendAlpha >= 0.01;

    // Skip expensive redraw when frame is unchanged and no blend overlay is active.
    if (!hasBlendWork && lastDrawnSequenceKey === activeSequenceKey && lastDrawnFrame === targetFrame) {
        return;
    }

    const img = getNearestLoadedFrame(activeCache, activeSequenceConfig, targetFrame);
    if (!img) return;

    lastDrawnSequenceKey = activeSequenceKey;
    lastDrawnFrame = targetFrame;

    const canvasRatio = window.innerWidth / window.innerHeight;
    const imgRatio = img.width / img.height;
    let sw, sh, sx, sy;

    if (canvasRatio > imgRatio) {
        sw = img.width;
        sh = img.width / canvasRatio;
        sx = 0;
        sy = (img.height - sh) / 2;
    } else {
        sh = img.height;
        sw = img.height * canvasRatio;
        sx = (img.width - sw) / 2;
        sy = 0;
    }
    seqCtx.drawImage(img, sx, sy, sw, sh, 0, 0, seqCanvas.width, seqCanvas.height);

    if (blendAlpha < 0.01 || !blendCtx) return;

    const targetFrame2 = THREE.MathUtils.clamp(targetFrame, SEQUENCE_2.start, SEQUENCE_2.end);
    const img2 = getNearestLoadedFrame(sequence2Cache, SEQUENCE_2, targetFrame2);
    if (!img2) return;

    if (blendCanvas.width !== seqCanvas.width || blendCanvas.height !== seqCanvas.height) {
        blendCanvas.width = seqCanvas.width;
        blendCanvas.height = seqCanvas.height;
    }
    blendCtx.clearRect(0, 0, blendCanvas.width, blendCanvas.height);
    blendCtx.drawImage(img2, sx, sy, sw, sh, 0, 0, blendCanvas.width, blendCanvas.height);

    const mx = ((mouse.x + 1) * 0.5) * blendCanvas.width;
    const my = ((1 - mouse.y) * 0.5) * blendCanvas.height;
    const radiusPx = SEQUENCE_BLEND.radiusNdc * Math.min(blendCanvas.width, blendCanvas.height);
    const innerRadiusPx = radiusPx * (1 - THREE.MathUtils.clamp(SEQUENCE_BLEND.softness, 0.05, 0.95));

    const gradient = blendCtx.createRadialGradient(mx, my, innerRadiusPx, mx, my, radiusPx);
    gradient.addColorStop(0, `rgba(0,0,0,${blendAlpha * SEQUENCE_BLEND.maxAlpha})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    blendCtx.globalCompositeOperation = 'destination-in';
    blendCtx.fillStyle = gradient;
    blendCtx.fillRect(0, 0, blendCanvas.width, blendCanvas.height);
    blendCtx.globalCompositeOperation = 'source-over';

    seqCtx.drawImage(blendCanvas, 0, 0, seqCanvas.width, seqCanvas.height);
}

// Ensure canvas matches screen on load
if (seqCanvas) {
    seqCanvas.width = window.innerWidth;
    seqCanvas.height = window.innerHeight;
}
blendCanvas.width = window.innerWidth;
blendCanvas.height = window.innerHeight;
preloadSequenceByKey('default', true);

// --- 3. GLOBAL SCENE ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.layers.enable(1);

const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById("bg-canvas"),
    antialias: true,
    alpha: true,
    premultipliedAlpha: false // Keeps alpha compositing predictable over the sequence canvas
});
renderer.setClearColor(0x000000, 0);

const perfProfile = (() => {
    const cores = navigator.hardwareConcurrency || 8;
    const memory = navigator.deviceMemory || 8;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 800;
    const lowEnd = cores <= 4 || memory <= 4 || smallScreen;

    return {
        lowEnd,
        pixelRatioCap: lowEnd ? 1.25 : 2,
        bloomScale: lowEnd ? 0.5 : 0.75,
        outlineScale: lowEnd ? 0.35 : 0.5,
        warmupCompile: !lowEnd
    };
})();

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, perfProfile.pixelRatioCap));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

// Post-Processing
const hdrRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat
});

const renderPass = new RenderPass(scene, camera);
const composer = new EffectComposer(renderer, hdrRenderTarget);
composer.addPass(renderPass);
const usePostProcessing = false;

const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth * perfProfile.bloomScale, window.innerHeight * perfProfile.bloomScale),
    3, 0.5, 1.2
);
composer.addPass(bloomPass);

const outlinePass = new OutlinePass(
    new THREE.Vector2(window.innerWidth * perfProfile.outlineScale, window.innerHeight * perfProfile.outlineScale),
    scene, camera
);
outlinePass.downSampleRatio = perfProfile.lowEnd ? 3 : 2; 
outlinePass.edgeStrength = perfProfile.lowEnd ? 2.4 : 4.0;
outlinePass.edgeGlow = perfProfile.lowEnd ? 0.65 : 1.0;
outlinePass.edgeThickness = perfProfile.lowEnd ? 1.5 : 2.0;
outlinePass.visibleEdgeColor.set(0x00ff44); 
outlinePass.hiddenEdgeColor.set(0x002200);
composer.addPass(outlinePass);

setupSceneLights(scene);

// --- 4. SCENE DATA ---
const mouse = new THREE.Vector2(-100, -100);
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();
const tempVec = new THREE.Vector3();

function getTapeRootFromObject(object3D) {
    let current = object3D;
    while (current) {
        if (current.userData && typeof current.userData.index === 'number') {
            return current;
        }
        current = current.parent;
    }
    return null;
}

// --- 5. LOAD MODELS & LOADING SCREEN ---
const tapeManager = new THREE.LoadingManager(); 
const loadingScreen = document.getElementById("loading-screen");
const progressBarFill = document.getElementById("progress-bar");
const loadingTextEl = document.getElementById("loading-text");

const startupParams = new URLSearchParams(window.location.search);
const shouldQuickResume = sessionStorage.getItem('skipBootLoader') === '1' || localStorage.getItem('returnTapeIndex') !== null || startupParams.has('action');

let bootComplete = false;
let tapesComplete = false;
let finalStateHandled = false;

let targetProgress = 0;
let displayedProgress = 0;
let bootFinished = false; 
let sequenceProgress = 0;
let tapeProgress = 0;

if (shouldQuickResume) {
    if (loadingTextEl) loadingTextEl.innerText = "RESUMING ARCHIVE...";
    if (progressBarFill) progressBarFill.style.width = "92%";
    displayedProgress = 92;
}

function runFinalLoadStateOnce() {
    if (finalStateHandled) return;
    finalStateHandled = true;
    handleFinalLoadState();
}

function updateLoadProgress() {
    targetProgress = Math.min(100, (sequenceProgress * 0.85 + tapeProgress * 0.15) * 100);

    if (sequenceProgress >= 1 && !bootFinished) {
        bootFinished = true;
        bootComplete = true;
        if (tapesComplete) runFinalLoadStateOnce();
    }
}

const progressInterval = setInterval(() => {
    if (displayedProgress < targetProgress) {
        if (bootFinished) {
            displayedProgress += 15; 
        } else {
            displayedProgress += (targetProgress - displayedProgress) * 0.15;
            displayedProgress += Math.random() * 2;
        }

        if (displayedProgress > targetProgress) displayedProgress = targetProgress;
        if (progressBarFill) progressBarFill.style.width = `${displayedProgress}%`;
        if (loadingTextEl) {
            loadingTextEl.innerText = `SYNCING ARCHIVES... [${Math.floor(displayedProgress)}%] FRAMES:${sequenceLoadedCount}/${SEQUENCE.total}`;
        }
    }

    if (displayedProgress >= 100 && bootFinished && tapesComplete) {
        clearInterval(progressInterval);
        setTimeout(() => {
            if(loadingScreen) loadingScreen.style.opacity = "0";
            setTimeout(() => {
                if(loadingScreen) loadingScreen.style.display = "none";
                document.body.style.opacity = "1";
                if (tapesComplete) runFinalLoadStateOnce();
            }, 380); 
        }, 80); 
    }
}, 30);

tapeManager.onProgress = (url, loaded, total) => {
    tapeProgress = total > 0 ? loaded / total : 0;
    updateLoadProgress();
};

tapeManager.onLoad = () => {
    tapesComplete = true;
    tapeProgress = 1;
    updateLoadProgress();
    if (bootComplete) runFinalLoadStateOnce();
};

tapeManager.onError = (url) => {
    console.error(`ERROR: Failed to load model asset: ${url}`);
    tapeProgress = 1;
    tapesComplete = true;
    updateLoadProgress();
    if (bootComplete) runFinalLoadStateOnce();
};

function handleFinalLoadState() {
    const returnIndex = localStorage.getItem('returnTapeIndex');
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (returnIndex !== null) {
        localStorage.removeItem('returnTapeIndex'); 
        const tapeId = parseInt(returnIndex);
        state.currentScroll = tapeId;
        state.targetScroll = tapeId;
        cachedConfig = getVisibleConfig();

        state.zoom = 1;
        state.targetZoom = 1;
        camera.position.set(POS_END.x, POS_END.y, POS_END.z);
        camera.lookAt(0, 0.8, -10);

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

    } else if (action && (action === "projects" || action === "home" || action === "contact" || action === "about")) {
        if (action === "projects" || action === "home") {
            state.zoom = 0; state.targetZoom = 0;
            camera.position.set(POS_START.x, POS_START.y, POS_START.z);
        } else {
            state.zoom = 1; state.targetZoom = 1;
            camera.position.set(POS_END.x, POS_END.y, POS_END.z);
        }
        camera.lookAt(0, 0.8, -10);
        window.history.replaceState({}, document.title, window.location.pathname);
        handleSystemAction(action);
    }
}

// --- TAPE LOADER ---
const tapeLoader = new GLTFLoader(tapeManager);
tapeLoader.load("models/tape.glb", gltf => {
    for (let i = 0; i < numTapes; i++) {
        const tape = gltf.scene.clone();
        const mixer = new THREE.AnimationMixer(tape);

        let action1 = gltf.animations[1] ? mixer.clipAction(gltf.animations[1]) : null;
        let action2 = gltf.animations[0] ? mixer.clipAction(gltf.animations[0]) : null;

        if (action1) { action1.setLoop(THREE.LoopOnce); action1.clampWhenFinished = true; action1.timeScale = 1.0; }
        if (action2) { action2.setLoop(THREE.LoopOnce); action2.clampWhenFinished = true; action2.timeScale = 1.0; }

        tape.scale.set(1, 1, 1);
        tape.position.set(0, 0.4, 0);

        tape.userData = {
            index: i,
            mixer: mixer,
            action1: action1,
            action2: action2,
            projectInfo: projectData[i],
            highlightMats: []
        };

        tape.traverse(c => {
            if (c.isMesh) {
                c.frustumCulled = false;
                c.castShadow = true;

                // ✅ THE FIX: Clone the material so each tape can change color independently!
                if (Array.isArray(c.material)) {
                    c.material = c.material.map(m => m.clone());
                } else if (c.material) {
                    c.material = c.material.clone();
                }

                // Now grab the newly cloned materials for your highlight logic
                const mats = Array.isArray(c.material) ? c.material : [c.material];
                mats.forEach((mat) => {
                    if (!mat) return;
                    if (!tape.userData.highlightMats.includes(mat)) {
                        tape.userData.highlightMats.push(mat);
                    }
                    mat.transparent = false;
                    mat.opacity = 1;
                    mat.depthWrite = true;
                    if (!mat.userData) mat.userData = {};
                    if (mat.color && !mat.userData.baseColor) {
                        mat.userData.baseColor = mat.color.clone();
                    }
                    if (typeof mat.emissiveIntensity === 'number' && typeof mat.userData.baseEmissiveIntensity !== 'number') {
                        mat.userData.baseEmissiveIntensity = mat.emissiveIntensity;
                    }
                    mat.needsUpdate = true;
                });
            }
        });

        scene.add(tape);
        tapes.push(tape);
    }
});

// --- 6. LOGIC & ROUTING ---
window.handleSystemAction = handleSystemAction;
function handleSystemAction(action) {
    if (state.isLocked) {
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
        case "home":
            pendingSectionSequenceKey = null;
            activeSequenceKey = 'default';
            preloadSequenceByKey('default', false);
            drawSequence(sequenceTimelineFrame / SEQUENCE_TIMELINE.zoomedLoopEndFrame);
            state.targetZoom = 0;
            break;
        case "about":
            if (state.zoom > 0.05) {
                pendingSectionSequenceKey = 'about';
                activeSequenceKey = 'default';
                preloadSequenceByKey('default', false);
            } else {
                pendingSectionSequenceKey = null;
                activeSequenceKey = 'about';
                preloadSequenceByKey('about', false);
            }
            drawSequence(sequenceTimelineFrame / SEQUENCE_TIMELINE.zoomedLoopEndFrame);
            state.targetZoom = 0;
            break;
        case "contact":
            if (state.zoom > 0.05) {
                pendingSectionSequenceKey = 'contact';
                activeSequenceKey = 'default';
                preloadSequenceByKey('default', false);
            } else {
                pendingSectionSequenceKey = null;
                activeSequenceKey = 'contact';
                preloadSequenceByKey('contact', false);
            }
            drawSequence(sequenceTimelineFrame / SEQUENCE_TIMELINE.zoomedLoopEndFrame);
            state.targetZoom = 0;
            break;
        case "projects":
            pendingSectionSequenceKey = null;
            activeSequenceKey = 'default';
            preloadSequenceByKey('default', false);
            drawSequence(sequenceTimelineFrame / SEQUENCE_TIMELINE.zoomedLoopEndFrame);
            state.targetZoom = 1; 
            break;
    }
}

function openProjectPage(data) {
    if (data && data.url) {
        sessionStorage.setItem('skipBootLoader', '1');
        document.body.style.transition = "opacity 0.5s ease";
        document.body.style.opacity = "0";

        setTimeout(() => {
            window.location.href = data.url;
        }, 500); 
    }
}

// --- 7. EVENTS ---
window.addEventListener("mousemove", e => {
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

let scrollCooldown = false;
const SCROLL_DELAY = 50;

window.addEventListener("wheel", e => {
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, perfProfile.pixelRatioCap));
    
    if (seqCanvas) {
        seqCanvas.width = window.innerWidth;
        seqCanvas.height = window.innerHeight;
    }
    blendCanvas.width = window.innerWidth;
    blendCanvas.height = window.innerHeight;

    cachedConfig = getVisibleConfig();
    const { radius } = cachedConfig;
    state.targetScroll = THREE.MathUtils.clamp(state.targetScroll, radius, numTapes - 1 - radius);
    outlinePass.resolution.set(
        window.innerWidth * perfProfile.outlineScale,
        window.innerHeight * perfProfile.outlineScale
    );
});

window.addEventListener('click', () => {
    if (state.zoom > 0.9 && state.activeTape && !state.isLocked) {
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
                setTimeout(() => { state.targetZoom = 0; }, 500);
            }
        }, 400);
    }
});

// --- 8. ANIMATE ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    // 1. SCROLL WHEEL OVERRIDE
    // If the mouse wheel pushes us towards the tapes (zoom > 0.5), force the default sequence.
    if (state.targetZoom > 0.5) {
        pendingSectionSequenceKey = null;
        if (activeSequenceKey !== 'default') {
            activeSequenceKey = 'default';
            preloadSequenceByKey('default', false);
        }
    }

    // 2. Smooth zoom lerp
    state.zoom = THREE.MathUtils.lerp(state.zoom, state.targetZoom, 0.06);

    // 3. APPLY DEFERRED SEQUENCE
    // Only switch to About/Contact once the zoom-out animation has settled completely.
    if (pendingSectionSequenceKey && state.targetZoom === 0 && state.zoom < 0.03) {
        activeSequenceKey = pendingSectionSequenceKey;
        preloadSequenceByKey(activeSequenceKey, false);
        pendingSectionSequenceKey = null;
    }

    // 4. SCROLL TAPES
    state.currentScroll = THREE.MathUtils.lerp(state.currentScroll, state.targetScroll, state.scrollSpeed);

    const { radius } = cachedConfig; 
    const center = Math.round(state.currentScroll);
    const visibleTapes = [];

    let currentFrameActiveTape = null;
    let currentFrameMinDist = 999;

    tapes.forEach((tape, i) => {
        tape.visible = i >= center - radius && i <= center + radius;
        if (tape.visible && tape.userData.mixer) tape.userData.mixer.update(delta);
        if (!tape.visible) return;
        visibleTapes.push(tape);

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

    let hoveredTapeFromRay = null;
    if (state.zoom > 0.9) {
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(visibleTapes, true);
        if (hits.length > 0) {
            hoveredTapeFromRay = getTapeRootFromObject(hits[0].object);
        }
    }

    state.activeTape = hoveredTapeFromRay || (state.zoom > 0.9 ? currentFrameActiveTape : null);
    state.minDist = currentFrameMinDist;

    const tapeToOutline = state.selectedTape || state.activeTape;
    outlinePass.selectedObjects = tapeToOutline ? [tapeToOutline] : [];

    const hoverFocusTape = (!state.isLocked && state.zoom > 0.9) ? state.activeTape : null;
    const selectedFocusTape = (state.selectedTape && state.selectedTape.visible) ? state.selectedTape : null;
    const focusTape = selectedFocusTape || hoverFocusTape;
    const hasFocusCandidate = !!focusTape && focusTape.visible;
    const focusIndex = hasFocusCandidate ? focusTape.userData.index : -1;

    // Lightweight hover highlight (no extra render pass): focused tape bright, others dim.
    tapes.forEach((tape) => {
        const highlighted = hasFocusCandidate && tape.userData.index === focusIndex;

        const mats = tape.userData.highlightMats || [];
        mats.forEach((mat) => {
            if (!mat || !mat.userData) return;

            if (mat.color && mat.userData.baseColor) {
                if (hasFocusCandidate) {
                    if (highlighted) {
                        TAPE_TMP_COLOR.copy(mat.userData.baseColor).lerp(TAPE_HIGHLIGHT_COLOR, TAPE_HIGHLIGHT.colorLift);
                        mat.color.lerp(TAPE_TMP_COLOR, TAPE_HIGHLIGHT.colorLerp);
                    } else {
                        TAPE_TMP_COLOR.copy(mat.userData.baseColor).multiplyScalar(TAPE_HIGHLIGHT.dimOthers);
                        mat.color.lerp(TAPE_TMP_COLOR, TAPE_HIGHLIGHT.colorLerp);
                    }
                } else {
                    mat.color.lerp(mat.userData.baseColor, TAPE_HIGHLIGHT.colorLerp);
                }
            }

            if (typeof mat.emissiveIntensity === 'number') {
                const baseEmissive = (typeof mat.userData.baseEmissiveIntensity === 'number') ? mat.userData.baseEmissiveIntensity : 0;
                const targetEmissive = hasFocusCandidate
                    ? (baseEmissive + (highlighted ? TAPE_HIGHLIGHT.emissiveBoost : 0))
                    : baseEmissive;
                mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, targetEmissive, TAPE_HIGHLIGHT.emissiveLerp);
            }
        });
    });

    // Hover Animation Triggers
    if (!state.isLocked && state.activeTape !== state.previousTape) {
        const hoverUI = document.getElementById('tape-hover-ui');
        if (state.previousTape?.userData.action1) {
            const hov = state.previousTape.userData.action1;
            hov.paused = false; hov.timeScale = -1; hov.play();
            if(hoverUI) hoverUI.classList.remove('visible');
        }
        if (state.activeTape?.userData.action1) {
            const hov = state.activeTape.userData.action1;
            hov.paused = false; hov.timeScale = 1; hov.play();
            const data = state.activeTape.userData.projectInfo;
            if (data && hoverUI) {
                document.getElementById('hover-category').innerText = data.category ? data.category.toUpperCase() : "SYSTEM FILE";
                document.getElementById('hover-title').innerText = data.title ? data.title.toUpperCase() : "UNKNOWN_DATA";
                document.getElementById('hover-desc').innerText = data.shortDesc ? data.shortDesc : "";
                hoverUI.classList.add('visible');
            }
        }
        state.previousTape = state.activeTape;
    }

    // 3. CAMERA
    const targetX = THREE.MathUtils.lerp(POS_START.x, POS_END.x, state.zoom);
    const targetY = THREE.MathUtils.lerp(POS_START.y, POS_END.y, state.zoom);
    const targetZ = THREE.MathUtils.lerp(POS_START.z, POS_END.z, state.zoom);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.04);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.04);
    camera.lookAt(0, 0.8, -10);

    // 4. SCRUB THE BACKGROUND SEQUENCE USING ACTUAL CAMERA TRAVEL
    const framesToAdvance = delta * SEQUENCE_TIMELINE.fps;
    const loopBoundary = getLoopBoundaryFrame();
    const cameraTravel = THREE.MathUtils.clamp(
        (camera.position.z - POS_START.z) / (POS_END.z - POS_START.z),
        0,
        1
    );

    if (cameraTravel >= 0.98 && state.targetZoom > 0.5) {
        // Fully zoomed in: loop the deep segment.
        sequenceTimelineFrame += framesToAdvance;
        if (sequenceTimelineFrame < SEQUENCE_TIMELINE.animEndFrame) {
            sequenceTimelineFrame = SEQUENCE_TIMELINE.animEndFrame;
        }
        if (sequenceTimelineFrame >= SEQUENCE_TIMELINE.zoomedLoopEndFrame) {
            sequenceTimelineFrame = SEQUENCE_TIMELINE.animEndFrame;
        }
    } else if (cameraTravel > 0.02) {
        // Transition phase directly follows real camera movement.
        sequenceTimelineFrame = THREE.MathUtils.lerp(
            loopBoundary,
            SEQUENCE_TIMELINE.animEndFrame,
            cameraTravel
        );
    } else {
        // Fully zoomed out: loop the idle outer segment.
        if (sequenceTimelineFrame > loopBoundary) {
            sequenceTimelineFrame = loopBoundary;
        }
        sequenceTimelineFrame += framesToAdvance;
        if (sequenceTimelineFrame > loopBoundary) {
            sequenceTimelineFrame = 0;
        }
    }

    renderSequenceFromTimeline(sequenceTimelineFrame);

    // 5. CURSOR
    if (!state.isLocked) {
        let cursorStyle = "default";
        if (state.zoom > 0.9 && state.activeTape) {
            cursorStyle = "pointer";
        }
        document.body.style.cursor = cursorStyle;
    }

    if (usePostProcessing) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

animate();