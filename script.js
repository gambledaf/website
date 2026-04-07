import * as THREE from "https://esm.sh/three@0.129.0";
import { GLTFLoader } from "https://esm.sh/three@0.129.0/examples/jsm/loaders/GLTFLoader.js";
import { RenderPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/RenderPass.js";
import { EffectComposer } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/OutlinePass.js";

const moduleVersion = new URL(import.meta.url).searchParams.get('v') || '';
const withVersion = (path) => {
    if (!moduleVersion) return path;
    const sep = path.includes('?') ? '&' : '?';
    return `${path}${sep}v=${encodeURIComponent(moduleVersion)}`;
};

const [{ setupSceneLights }, { projectData }] = await Promise.all([
    import(withVersion('./js/lights.js')),
    import(withVersion('./js/files.js'))
]);

// --- 1. SHARED HELPERS & STATE ---
function getVisibleConfig() {
    const aspect = window.innerWidth / window.innerHeight;
    
    let count = 9; // Always default to 9 for widescreens
    
    if (aspect < 0.8) {
        // Tall, narrow screens (Mobile phones in portrait mode)
        count = 5; 
    } else if (aspect < 1.4) {
        // Square-ish screens (Tablets, or slightly squished browser windows)
        count = 7; 
    }
    
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

let projectOpenTimeoutId = null;
let flipTimeoutId = null;
let zoomOutTimeoutId = null;
const LOCK_CENTER_SCROLL_SPEED = 0.04;
const LOCK_FOCUS_SCROLL_SPEED = 0.03;
const LOCK_CENTER_EPSILON = 0.02;
const LOCK_CENTER_MAX_WAIT_MS = 1000;
const LOCK_CENTER_POLL_MS = 16;

function clearProjectTransitionTimers() {
    if (projectOpenTimeoutId) {
        clearTimeout(projectOpenTimeoutId);
        projectOpenTimeoutId = null;
    }
    if (flipTimeoutId) {
        clearTimeout(flipTimeoutId);
        flipTimeoutId = null;
    }
    if (zoomOutTimeoutId) {
        clearTimeout(zoomOutTimeoutId);
        zoomOutTimeoutId = null;
    }
}

function unlockTapeSelection({ resetFlipInstantly = false } = {}) {
    const selected = state.selectedTape;
    if (selected) {
        const hov = selected.userData.action1;
        const flip = selected.userData.action2;

        if (hov) {
            hov.stop();
            hov.reset();
        }

        if (flip) {
            if (resetFlipInstantly) {
                flip.stop();
                flip.reset();
            } else {
                flip.paused = false;
                flip.timeScale = -1;
                flip.play();
            }
        }
    }

    state.isLocked = false;
    state.selectedTape = null;
    state.scrollSpeed = 0.1;
}

function restoreArchiveInteractionState() {
    clearProjectTransitionTimers();
    unlockTapeSelection({ resetFlipInstantly: true });
    state.activeTape = null;
    state.previousTape = null;
    document.body.style.cursor = 'default';
}

const POS_START = { x: 0, y: 0.6, z: -1.5 };
const POS_END   = { x: 0, y: 0.4, z: 5 };
const TAPE_HIGHLIGHT = {
    dimOthers: 0.35,
    dimRange: 2.0,
    colorLift: 0.28,
    colorLerp: 0.12,
    emissiveBoost: 0.22,
    emissiveLerp: 0.12
};
const TAPE_HIGHLIGHT_COLOR = new THREE.Color(0xffffff);
const TAPE_TMP_COLOR = new THREE.Color();


// --- 2. SEQUENCE BACKGROUND SETUP ---
const SEQUENCE = {
    folder: 'sequence_01',
    start: 1,
    end: 120,
    pad: 4,
    ext: 'jpg',
    total: 120
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
    end: 60,
    pad: 4,
    ext: 'jpg',
    total: 60
};

const CONTACT_SEQUENCE = {
    folder: 'contact',
    start: 1,
    end: 60,
    pad: 4,
    ext: 'jpg',
    total: 60
};

const SECTION_SEQUENCE_TIMELINE = {
    fps: 30,
    totalFrames: 60,
    introEndFrame: 30,
    loopStartFrame: 30,
    loopEndFrameExclusive: 60
};

const SECTION_PLAYBACK = {
    frameStep: 1
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
    powerOnEndFrame: 20,
    loopStartFrame: 20,
    loopEndFrame: 50,
    animEndFrame: 90,
    zoomedLoopEndFrame: 120
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
let sectionIntroPlayed = false;
let defaultPowerOnPlayed = false;
let pendingMenuAction = null;
let pendingScrollDelta = 0;
let sectionPreloadQueued = false;
const blendCanvas = document.createElement('canvas');
const blendCtx = blendCanvas.getContext('2d');

function activateSectionSequence(sequenceKey) {
    activeSequenceKey = sequenceKey;
    preloadSequenceByKey(sequenceKey, false);
    sequenceTimelineFrame = 0;
    sectionIntroPlayed = false;
    lastDrawnSequenceKey = null;
    lastDrawnFrame = -1;
}

// --- ADD THIS NEW HELPER ---
function activateDefaultSequence({ playPowerOn = true, resetFrame = true } = {}) {
    if (activeSequenceKey !== 'default') {
        activeSequenceKey = 'default';
        preloadSequenceByKey('default', false);

        if (playPowerOn) {
            if (resetFrame) sequenceTimelineFrame = 0;
            defaultPowerOnPlayed = false;
        } else {
            if (resetFrame) {
                sequenceTimelineFrame = Math.max(sequenceTimelineFrame, SEQUENCE_TIMELINE.loopStartFrame);
            }
            defaultPowerOnPlayed = true;
        }
        
        lastDrawnSequenceKey = null;
        lastDrawnFrame = -1;
    }
}

function queueMenuActionThroughPowerOn(action) {
    pendingMenuAction = action;
    pendingScrollDelta = 0;
    pendingSectionSequenceKey = null;
    activateDefaultSequence({ playPowerOn: true, resetFrame: true });
    state.targetZoom = 0;
}

function queueBackgroundSectionPreload() {
    if (sectionPreloadQueued) return;
    sectionPreloadQueued = true;

    const doPreload = () => {
        preloadSequenceByKey('about', false);
        preloadSequenceByKey('contact', false);
    };

    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(() => doPreload(), { timeout: 1200 });
    } else {
        setTimeout(doPreload, 700);
    }
}

function getLoopBoundaryFrame() {
    return THREE.MathUtils.clamp(
        SEQUENCE_TIMELINE.loopEndFrame,
        SEQUENCE_TIMELINE.loopStartFrame,
        Math.max(0, SEQUENCE_TIMELINE.animEndFrame - 1)
    );
}

function renderSequenceFromTimeline(timelineFrame) {
    if (activeSequenceKey === 'default') {
        // The default sequence uses the full 100-frame zoom track
        const normalized = THREE.MathUtils.clamp(timelineFrame, 0, SEQUENCE_TIMELINE.zoomedLoopEndFrame);
        const progress = normalized / SEQUENCE_TIMELINE.zoomedLoopEndFrame;
        drawSequence(progress);
    } else {
        // About & Contact: play full rendered frame stream at native section FPS.
        const activeSequenceConfig = sequenceConfigByKey[activeSequenceKey] || ABOUT_SEQUENCE;
        const maxOffset = Math.max(0, activeSequenceConfig.total - 1);
        const frameIndex = THREE.MathUtils.clamp(
            Math.floor(timelineFrame),
            0,
            maxOffset
        );

        let sampledOffset = Math.floor(frameIndex / SECTION_PLAYBACK.frameStep) * SECTION_PLAYBACK.frameStep;
        if (frameIndex === maxOffset) {
            // Keep the true final frame reachable so loops/endpoints do not feel truncated.
            sampledOffset = maxOffset;
        }

        const targetFrame = activeSequenceConfig.start + sampledOffset;
        drawSequence(0, targetFrame);
    }
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

    const isSectionSequence = sequenceKey === 'about' || sequenceKey === 'contact';

    for (let i = sequenceConfig.start; i <= sequenceConfig.end; i++) {
        if (isSectionSequence) {
            const relativeIndex = i - sequenceConfig.start;
            const isSampledFrame = (relativeIndex % SECTION_PLAYBACK.frameStep === 0) || i === sequenceConfig.end;
            if (!isSampledFrame) continue;
        }

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

function drawSequence(progress, forcedFrame = null) {
    if (!seqCtx) return;
    const activeSequenceConfig = sequenceConfigByKey[activeSequenceKey] || SEQUENCE;
    const activeCache = sequenceCachesByKey[activeSequenceKey] || sequenceCache;
    
    // Clamp progress between 0 and 1 just in case
    progress = Math.max(0, Math.min(1, progress));
    const progressFrameFloat = activeSequenceConfig.start + (progress * (activeSequenceConfig.total - 1));
    const progressFrame = Math.floor(progressFrameFloat);
    const targetFrame = (typeof forcedFrame === 'number')
        ? THREE.MathUtils.clamp(Math.floor(forcedFrame), activeSequenceConfig.start, activeSequenceConfig.end)
        : progressFrame;
    const targetFrameFloat = (typeof forcedFrame === 'number')
        ? THREE.MathUtils.clamp(forcedFrame, activeSequenceConfig.start, activeSequenceConfig.end)
        : progressFrameFloat;
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

    // Remap only the idle default timeline segment to sequence_02 so static remains lively at 60fps.
    const defaultFrameMin = SEQUENCE_TIMELINE.loopStartFrame;
    const defaultFrameMax = SEQUENCE_TIMELINE.loopEndFrame;
    const defaultFrameSpan = Math.max(1, defaultFrameMax - defaultFrameMin);
    const normalizedFrame = THREE.MathUtils.clamp((targetFrameFloat - defaultFrameMin) / defaultFrameSpan, 0, 1);
    const frame2Float = THREE.MathUtils.lerp(SEQUENCE_2.start, SEQUENCE_2.end, normalizedFrame);
    const baseFrame2 = THREE.MathUtils.clamp(Math.floor(frame2Float), SEQUENCE_2.start, SEQUENCE_2.end);
    const nextFrame2 = baseFrame2 >= SEQUENCE_2.end ? SEQUENCE_2.start : baseFrame2 + 1;
    const frame2Mix = THREE.MathUtils.clamp(frame2Float - baseFrame2, 0, 1);

    const img2Base = getNearestLoadedFrame(sequence2Cache, SEQUENCE_2, baseFrame2);
    if (!img2Base) return;
    const img2Next = getNearestLoadedFrame(sequence2Cache, SEQUENCE_2, nextFrame2) || img2Base;

    if (blendCanvas.width !== seqCanvas.width || blendCanvas.height !== seqCanvas.height) {
        blendCanvas.width = seqCanvas.width;
        blendCanvas.height = seqCanvas.height;
    }
    blendCtx.clearRect(0, 0, blendCanvas.width, blendCanvas.height);
    blendCtx.globalAlpha = 1;
    blendCtx.drawImage(img2Base, sx, sy, sw, sh, 0, 0, blendCanvas.width, blendCanvas.height);
    if (frame2Mix > 0.001) {
        blendCtx.globalAlpha = frame2Mix;
        blendCtx.drawImage(img2Next, sx, sy, sw, sh, 0, 0, blendCanvas.width, blendCanvas.height);
    }
    blendCtx.globalAlpha = 1;

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
const skipBootLoaderOnce = sessionStorage.getItem('skipBootLoader') === '1';
if (skipBootLoaderOnce) {
    sessionStorage.removeItem('skipBootLoader');
}
const hasReturnTape = localStorage.getItem('returnTapeIndex') !== null;
const hasActionParam = startupParams.has('action');
const shouldQuickResume = skipBootLoaderOnce || hasReturnTape || hasActionParam;
const shouldSkipPowerOnIntro = hasReturnTape || hasActionParam;

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

    if (shouldSkipPowerOnIntro) {
        defaultPowerOnPlayed = true;
        sequenceTimelineFrame = Math.max(sequenceTimelineFrame, SEQUENCE_TIMELINE.loopStartFrame);
    }
}

function runFinalLoadStateOnce() {
    if (finalStateHandled) return;
    finalStateHandled = true;
    handleFinalLoadState();
    queueBackgroundSectionPreload();
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
        const parsedTapeId = Number.parseInt(returnIndex, 10);
        const tapeId = Number.isFinite(parsedTapeId)
            ? THREE.MathUtils.clamp(parsedTapeId, 0, Math.max(0, numTapes - 1))
            : 0;
        cachedConfig = getVisibleConfig();

        const restoredScroll = clampTapeTargetScroll(tapeId);
        state.currentScroll = restoredScroll;
        state.targetScroll = restoredScroll;

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
        clearProjectTransitionTimers();
        unlockTapeSelection();
    }

    const isSectionAction = action === 'about' || action === 'contact';

    // About/Contact should switch directly without replaying default 0-20 intro.
    if (isSectionAction) {
        pendingMenuAction = null;
        pendingScrollDelta = 0;
        pendingSectionSequenceKey = null;
        activateSectionSequence(action);
        drawSequence(0);
        state.targetZoom = 0;
        return;
    }

    // If we're in About/Contact, route menu action through default power-on first.
    if (activeSequenceKey !== 'default') {
        queueMenuActionThroughPowerOn(action);
        return;
    }

    // If power-on is currently playing, queue the latest action and apply it when intro completes.
    if (!defaultPowerOnPlayed) {
        pendingMenuAction = action;
        return;
    }

    switch (action) {
        case "home":
            pendingSectionSequenceKey = null;
            activateDefaultSequence(); // <-- Updated
            drawSequence(sequenceTimelineFrame / SEQUENCE_TIMELINE.zoomedLoopEndFrame);
            state.targetZoom = 0;
            break;
        case "projects":
            pendingSectionSequenceKey = null;
            activateDefaultSequence(); // <-- Updated
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

    if (dragState.awaitingHoverRearm) {
        if (Math.abs(e.clientX - dragState.releaseX) >= DRAG_HOVER_REARM_DISTANCE_PX) {
            dragState.awaitingHoverRearm = false;
        }
    }
});

const copyBtn = document.getElementById('copyEmailBtn');
const emailHotspot = document.getElementById('hotspot-email');
const linkedinHotspot = document.getElementById('hotspot-linkedin');
const feedbackMsg = document.getElementById('copyFeedback');
let copyFeedbackTimeoutId = null;

function showCopyFeedback(message) {
    if (!feedbackMsg) return;

    feedbackMsg.textContent = message;
    feedbackMsg.classList.add('visible');

    if (copyFeedbackTimeoutId) {
        clearTimeout(copyFeedbackTimeoutId);
    }

    copyFeedbackTimeoutId = setTimeout(() => {
        feedbackMsg.classList.remove('visible');
        copyFeedbackTimeoutId = null;
    }, 1800);
}

function fallbackCopyText(text) {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    helper.style.pointerEvents = 'none';
    helper.style.left = '-9999px';
    document.body.appendChild(helper);

    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    let success = false;
    try {
        success = document.execCommand('copy');
    } catch {
        success = false;
    }

    helper.remove();
    return success;
}

function getEmailToCopy() {
    const fromButton = copyBtn?.getAttribute('data-email') || '';
    if (fromButton) return fromButton;

    const fromHotspotData = emailHotspot?.getAttribute('data-email') || '';
    if (fromHotspotData) return fromHotspotData;

    const href = emailHotspot?.getAttribute('href') || '';
    if (href.toLowerCase().startsWith('mailto:')) {
        return href.slice('mailto:'.length).trim();
    }

    return '';
}

async function handleCopyEmail(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (activeSequenceKey !== 'contact') return;

    const emailToCopy = getEmailToCopy();
    if (!emailToCopy) return;

    let copied = false;

    if (navigator.clipboard && window.isSecureContext) {
        try {
            await navigator.clipboard.writeText(emailToCopy);
            copied = true;
        } catch {
            copied = false;
        }
    }

    if (!copied) {
        copied = fallbackCopyText(emailToCopy);
    }

    if (copied) {
        showCopyFeedback('Email copied!');
    } else {
        showCopyFeedback('Copy failed');
    }
}

if (copyBtn) {
    copyBtn.addEventListener('click', handleCopyEmail);
}

if (emailHotspot) {
    emailHotspot.addEventListener('click', handleCopyEmail);
}

if (linkedinHotspot) {
    linkedinHotspot.addEventListener('click', (event) => {
        if (activeSequenceKey !== 'contact') {
            event.preventDefault();
        }
        event.stopPropagation();
    });
}

let scrollCooldown = false;
const SCROLL_DELAY = 70;
const ZOOM_SCROLL_READY = 0.92;
const ZOOM_IN_SCROLL_LOCK_MS = 360;
const ZOOM_OUT_INTENT_THRESHOLD = 1.4;
const DRAG_ACTIVE_ZOOM = 0.85;
const DRAG_START_THRESHOLD_PX = 6;

const DRAG_CLICK_SUPPRESS_MS = 220;
const DRAG_HOVER_SUPPRESS_MS = 180;
const DRAG_HOVER_REARM_DISTANCE_PX = 10;
let zoomOutIntent = 0;
let zoomInScrollUnlockAt = 0;

const dragState = {
    active: false,
    moved: false,
    startX: 0,
    lastX: 0,
    suppressClickUntil: 0,
    hoverSuppressUntil: 0,
    awaitingHoverRearm: false,
    releaseX: 0,
    pointerId: null
};

function clampTapeTargetScroll(value) {
    const { radius } = cachedConfig;
    return THREE.MathUtils.clamp(value, radius, numTapes - 1 - radius);
}

function canStartTapeDrag() {
    if (state.isLocked) return false;
    if (activeSequenceKey !== 'default') return false;
    if (!defaultPowerOnPlayed) return false;
    return state.zoom >= DRAG_ACTIVE_ZOOM || state.targetZoom >= DRAG_ACTIVE_ZOOM;
}

function onTapeDragStart(e) {
    if (e.button !== 0) return;
    if (!canStartTapeDrag()) return;

    dragState.active = true;
    dragState.moved = false;
    dragState.startX = e.clientX;
    dragState.lastX = e.clientX;
    dragState.pointerId = e.pointerId;
    dragState.awaitingHoverRearm = false;
    zoomOutIntent = 0;

    if (renderer?.domElement?.setPointerCapture) {
        try {
            renderer.domElement.setPointerCapture(e.pointerId);
        } catch (_) {
            // Ignore capture errors from unsupported pointer states.
        }
    }
}

function onTapeDragMove(e) {
    if (!dragState.active) return;

    const distanceFromStart = e.clientX - dragState.startX;
    if (!dragState.moved && Math.abs(distanceFromStart) < DRAG_START_THRESHOLD_PX) {
        dragState.lastX = e.clientX;
        return;
    }
    dragState.moved = true;
    dragState.hoverSuppressUntil = performance.now() + DRAG_HOVER_SUPPRESS_MS;

    const deltaX = e.clientX - dragState.lastX;
    dragState.lastX = e.clientX;
    if (deltaX === 0) return;

    state.targetZoom = 1;

    // The grip strength (6.0 usually feels great here)
    const dynamicScrollFactor = 6.0 / window.innerWidth; 
    
    // We update where the tape SHOULD be...
    state.targetScroll = clampTapeTargetScroll(state.targetScroll - (deltaX * dynamicScrollFactor));
    
    // ...BUT WE DO NOT FORCE IT INSTANTLY ANYMORE!
    // We let your animate() loop smoothly slide 'currentScroll' to 'targetScroll'
    
    zoomOutIntent = 0;
}

function onTapeDragEnd(e) {
    if (!dragState.active) return;

    if (dragState.moved) {
        dragState.suppressClickUntil = performance.now() + DRAG_CLICK_SUPPRESS_MS;
        dragState.awaitingHoverRearm = true;
        dragState.releaseX = typeof e?.clientX === 'number' ? e.clientX : dragState.lastX;
        dragState.hoverSuppressUntil = performance.now() + DRAG_HOVER_SUPPRESS_MS;
    } else {
        dragState.awaitingHoverRearm = false;
        dragState.hoverSuppressUntil = 0;
    }

    if (renderer?.domElement?.releasePointerCapture && dragState.pointerId !== null) {
        try {
            renderer.domElement.releasePointerCapture(dragState.pointerId);
        } catch (_) {
            // Ignore capture release errors from unsupported pointer states.
        }
    }

    dragState.active = false;
    dragState.moved = false;
    dragState.pointerId = null;
}

renderer.domElement.addEventListener('pointerdown', onTapeDragStart);
window.addEventListener('pointermove', onTapeDragMove, { passive: true });
window.addEventListener('pointerup', onTapeDragEnd);
window.addEventListener('pointercancel', onTapeDragEnd);

function applyWheelNavigation(deltaY) {
    const { radius } = cachedConfig;
    const now = performance.now();
    const zoomSettledIn = state.zoom >= ZOOM_SCROLL_READY;
    const atFirstTape = state.targetScroll <= radius + 0.001;

    if (deltaY > 5) {
        // Don't advance tape index until the camera has mostly finished zooming in.
        zoomOutIntent = 0;
        if (state.targetZoom < 1) {
            state.targetZoom = 1;
            zoomInScrollUnlockAt = now + ZOOM_IN_SCROLL_LOCK_MS;
            return;
        } else if (now < zoomInScrollUnlockAt) {
            return;
        } else if (!zoomSettledIn) {
            return;
        } else if (state.targetScroll < numTapes - 1 - radius) {
            state.targetScroll++;
        }
    } else if (deltaY < -5) {
        zoomInScrollUnlockAt = 0;
        if (!zoomSettledIn) {
            state.targetZoom = 0;
            zoomOutIntent = 0;
            return;
        }

        if (state.targetScroll > radius) {
            state.targetScroll--;
            zoomOutIntent = 0;
        } else {
            // Require a deliberate upward scroll gesture before leaving the first tape.
            const intentGain = Math.min(Math.abs(deltaY) / 24, 1);
            zoomOutIntent = atFirstTape ? (zoomOutIntent + intentGain) : 0;
            if (zoomOutIntent >= ZOOM_OUT_INTENT_THRESHOLD) {
                state.targetZoom = 0;
                zoomOutIntent = 0;
            }
        }
    }
}

window.addEventListener("wheel", e => {
    if (scrollCooldown) return;
    if (Math.abs(e.deltaY) <= 5) return;

    // If user scrolls while in About/Contact, play default 0-20 first, then apply scroll intent.
    if (activeSequenceKey !== 'default') {
        pendingSectionSequenceKey = null;
        pendingMenuAction = null;
        pendingScrollDelta = e.deltaY;
        activateDefaultSequence({ playPowerOn: true, resetFrame: true });
        state.targetZoom = 0;
        triggerCooldown();
        return;
    }

    // While default power-on is playing, queue latest scroll and apply after intro completes.
    if (!defaultPowerOnPlayed) {
        pendingScrollDelta = e.deltaY;
        triggerCooldown();
        return;
    }

    const prevZoom = state.targetZoom;
    const prevScroll = state.targetScroll;
    applyWheelNavigation(e.deltaY);

    if (state.targetZoom !== prevZoom || state.targetScroll !== prevScroll) {
        triggerCooldown();
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
    state.targetScroll = clampTapeTargetScroll(state.targetScroll);
    outlinePass.resolution.set(
        window.innerWidth * perfProfile.outlineScale,
        window.innerHeight * perfProfile.outlineScale
    );
});

window.addEventListener('click', () => {
    if (dragState.awaitingHoverRearm) return;
    if (performance.now() < dragState.suppressClickUntil) return;

    if (state.zoom > 0.9 && state.activeTape && !state.isLocked) {
        state.isLocked = true;
        
        // Use the smooth glide speed
        state.scrollSpeed = LOCK_CENTER_SCROLL_SPEED; 
        state.selectedTape = state.activeTape;
        state.targetScroll = state.activeTape.userData.index;

        // Keep the fix that instantly straightens the tape!
        state.activeTape.rotation.set(0, 0, 0);

        projectOpenTimeoutId = setTimeout(() => {
            projectOpenTimeoutId = null;
            const selected = state.selectedTape;
            if (!selected) return;
            const selectedProjectData = selected.userData.projectInfo;
            openProjectPage(selectedProjectData);
        }, 1500); 
        
        const hov = state.selectedTape.userData.action1;
        const flip = state.selectedTape.userData.action2;

        // RESTORED: The classic, snappy 400ms timing with no weird math delays!
        flipTimeoutId = setTimeout(() => {
            flipTimeoutId = null;
            if (flip) {
                if (hov) hov.stop();
                flip.reset();
                flip.setEffectiveWeight(1.0);
                flip.play();
                zoomOutTimeoutId = setTimeout(() => {
                    zoomOutTimeoutId = null;
                    state.targetZoom = 0;
                }, 500);
            }
        }, 400);
    }
});

window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
        restoreArchiveInteractionState();
    }
});

// --- TV HOTSPOT LOGIC ---
const hotspotContainer = document.getElementById('hotspot-container');

// 1. Wire up the clicks (Power is removed)
document.getElementById('hotspot-menu')?.addEventListener('click', () => handleSystemAction('home'));
document.getElementById('hotspot-about')?.addEventListener('click', () => handleSystemAction('about'));
document.getElementById('hotspot-projects')?.addEventListener('click', () => handleSystemAction('projects'));
document.getElementById('hotspot-contact')?.addEventListener('click', () => handleSystemAction('contact'));

// 2. Hide them when zooming in (Add this logic inside your Animate loop)

// --- 8. ANIMATE ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const hoverSuppressed = dragState.moved || dragState.awaitingHoverRearm || performance.now() < dragState.hoverSuppressUntil;

    // 1. SCROLL WHEEL OVERRIDE
    // If the mouse wheel pushes us towards the tapes (zoom > 0.5), force the default sequence.
    if (state.targetZoom > 0.5) {
        pendingSectionSequenceKey = null;
        if (activeSequenceKey !== 'default') {
            activateDefaultSequence({ playPowerOn: false, resetFrame: true });
        }
    }

    // 2. Smooth zoom lerp
    state.zoom = THREE.MathUtils.lerp(state.zoom, state.targetZoom, 0.06);

    if (hotspotContainer) {
        if (state.zoom > 0.1) {
            hotspotContainer.classList.add('zoomed-in');
        } else {
            hotspotContainer.classList.remove('zoomed-in');
        }

        const isContactActive = activeSequenceKey === 'contact' && state.zoom < 0.15 && state.targetZoom < 0.1;
        hotspotContainer.classList.toggle('contact-active', isContactActive);

        if (!isContactActive && feedbackMsg?.classList.contains('visible')) {
            feedbackMsg.classList.remove('visible');
            if (copyFeedbackTimeoutId) {
                clearTimeout(copyFeedbackTimeoutId);
                copyFeedbackTimeoutId = null;
            }
        }
    }

    // 3. APPLY DEFERRED SEQUENCE
    // Only switch to About/Contact once the zoom-out animation has settled completely.
    if (pendingSectionSequenceKey && state.targetZoom === 0 && state.zoom < 0.03) {
        activateSectionSequence(pendingSectionSequenceKey);
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

        if (state.zoom > 0.9 && !hoverSuppressed) {
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
    if (state.zoom > 0.9 && !hoverSuppressed) {
        raycaster.setFromCamera(mouse, camera);
        const hits = raycaster.intersectObjects(visibleTapes, true);
        if (hits.length > 0) {
            hoveredTapeFromRay = getTapeRootFromObject(hits[0].object);
        }
    }

    state.activeTape = hoverSuppressed ? null : (hoveredTapeFromRay || (state.zoom > 0.9 ? currentFrameActiveTape : null));
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
        const indexDistance = hasFocusCandidate ? Math.abs(tape.userData.index - focusIndex) : 0;
        const normalizedDistance = THREE.MathUtils.clamp(indexDistance / TAPE_HIGHLIGHT.dimRange, 0, 1);
        const dimProgress = THREE.MathUtils.smoothstep(normalizedDistance, 0, 1);
        const dimScalar = THREE.MathUtils.lerp(1, TAPE_HIGHLIGHT.dimOthers, dimProgress);

        const mats = tape.userData.highlightMats || [];
        mats.forEach((mat) => {
            if (!mat || !mat.userData) return;

            if (mat.color && mat.userData.baseColor) {
                if (hasFocusCandidate) {
                    if (highlighted) {
                        TAPE_TMP_COLOR.copy(mat.userData.baseColor).lerp(TAPE_HIGHLIGHT_COLOR, TAPE_HIGHLIGHT.colorLift);
                        mat.color.lerp(TAPE_TMP_COLOR, TAPE_HIGHLIGHT.colorLerp);
                    } else {
                        TAPE_TMP_COLOR.copy(mat.userData.baseColor).multiplyScalar(dimScalar);
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

    const canTiltActiveTape = !state.isLocked && state.zoom > 0.9 && !hoverSuppressed;

    tapes.forEach((tape) => {
        if (!tape.visible) return;

        // Keep clicked/selected tape animation untouched.
        if (state.selectedTape === tape) return;

        const isHoveredTape = canTiltActiveTape && tape === state.activeTape;
        const targetRotX = isHoveredTape ? -mouse.y * 0.15 : 0;
        const targetRotY = isHoveredTape ? mouse.x * 0.20 : 0;

        tape.rotation.x = THREE.MathUtils.lerp(tape.rotation.x, targetRotX, 0.1);
        tape.rotation.y = THREE.MathUtils.lerp(tape.rotation.y, targetRotY, 0.1);
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
    const activeTimelineFps = activeSequenceKey === 'default'
        ? SEQUENCE_TIMELINE.fps
        : SECTION_SEQUENCE_TIMELINE.fps;
    const framesToAdvance = delta * activeTimelineFps;

    if (activeSequenceKey === 'default') {
        const loopBoundary = getLoopBoundaryFrame();
        const cameraTravel = THREE.MathUtils.clamp(
            (camera.position.z - POS_START.z) / (POS_END.z - POS_START.z),
            0,
            1
        );

        if (!defaultPowerOnPlayed) {
            sequenceTimelineFrame += framesToAdvance;
            if (sequenceTimelineFrame >= SEQUENCE_TIMELINE.powerOnEndFrame) {
                sequenceTimelineFrame = SEQUENCE_TIMELINE.powerOnEndFrame;
                defaultPowerOnPlayed = true;

                if (pendingMenuAction) {
                    const queuedAction = pendingMenuAction;
                    pendingMenuAction = null;
                    handleSystemAction(queuedAction);
                }

                if (pendingScrollDelta !== 0) {
                    const queuedDelta = pendingScrollDelta;
                    pendingScrollDelta = 0;
                    applyWheelNavigation(queuedDelta);
                }
            }
        } else {
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
                const transitionTarget = THREE.MathUtils.lerp(
                    loopBoundary,
                    SEQUENCE_TIMELINE.animEndFrame,
                    cameraTravel
                );
                sequenceTimelineFrame = THREE.MathUtils.lerp(sequenceTimelineFrame, transitionTarget, 0.2);
            } else {
                // Fully zoomed out: loop the idle segment that now starts after power-on.
                if (sequenceTimelineFrame > loopBoundary) {
                    sequenceTimelineFrame = loopBoundary;
                }
                if (sequenceTimelineFrame < SEQUENCE_TIMELINE.loopStartFrame) {
                    sequenceTimelineFrame = SEQUENCE_TIMELINE.loopStartFrame;
                }
                sequenceTimelineFrame += framesToAdvance;
                if (sequenceTimelineFrame > loopBoundary) {
                    sequenceTimelineFrame = SEQUENCE_TIMELINE.loopStartFrame;
                }
            }
        }
    } else {
        if (!sectionIntroPlayed) {
            sequenceTimelineFrame += framesToAdvance;
            if (sequenceTimelineFrame >= SECTION_SEQUENCE_TIMELINE.introEndFrame) {
                sequenceTimelineFrame = SECTION_SEQUENCE_TIMELINE.introEndFrame;
                sectionIntroPlayed = true;
            }
        } else {
            if (sequenceTimelineFrame < SECTION_SEQUENCE_TIMELINE.loopStartFrame) {
                sequenceTimelineFrame = SECTION_SEQUENCE_TIMELINE.loopStartFrame;
            }

            sequenceTimelineFrame += framesToAdvance;

            const loopLength = SECTION_SEQUENCE_TIMELINE.loopEndFrameExclusive - SECTION_SEQUENCE_TIMELINE.loopStartFrame;
            if (loopLength > 0 && sequenceTimelineFrame >= SECTION_SEQUENCE_TIMELINE.loopEndFrameExclusive) {
                sequenceTimelineFrame = SECTION_SEQUENCE_TIMELINE.loopStartFrame + ((sequenceTimelineFrame - SECTION_SEQUENCE_TIMELINE.loopStartFrame) % loopLength);
            }
        }
    }

    renderSequenceFromTimeline(sequenceTimelineFrame);

    // 5. CURSOR
    if (!state.isLocked) {
        let cursorStyle = "default";
        if (dragState.active) {
            cursorStyle = "grabbing";
        } else if (state.zoom > 0.9 && state.activeTape) {
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