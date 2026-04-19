import * as THREE from "https://esm.sh/three@0.129.0";
import { GLTFLoader } from "https://esm.sh/three@0.129.0/examples/jsm/loaders/GLTFLoader.js";

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
        count = isCoarsePointerDevice ? 3 : 5;
    } else if (aspect < 1.4) {
        // Square-ish screens (Tablets, or slightly squished browser windows)
        count = 7; 
    }
    
    return { count, radius: (count - 1) / 2 };
}

const REFERENCE_ANIMATION_FPS = 180;

function getFrameRateIndependentLerpFactor(frameLerpFactor, deltaSeconds, referenceFps = REFERENCE_ANIMATION_FPS) {
    if (frameLerpFactor <= 0 || deltaSeconds <= 0) return 0;
    if (frameLerpFactor >= 1) return 1;

    const scaledFrames = deltaSeconds * referenceFps;
    return 1 - Math.pow(1 - frameLerpFactor, scaledFrames);
}

const isCoarsePointerDevice = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const DISABLE_PHONE_SEQUENCE_BLEND = isCoarsePointerDevice;
const DISABLE_PHONE_BUZZ_AUDIO = isCoarsePointerDevice;



let cachedConfig = getVisibleConfig();
const tapes = [];

const numTapes = projectData.length;
const tapeSpacing = 0.55;
const initialCenter = numTapes > 0 ? Math.min(cachedConfig.radius, (numTapes - 1) / 2) : 0;
const CATEGORY_ALL_KEY = '__ALL__';
const categoryFilterBar = document.getElementById('tape-category-filter');
const hoverUI = document.getElementById('tape-hover-ui');
const hoverTitleEl = document.getElementById('hover-title');
const hoverCategoryEl = document.getElementById('hover-category');
const hoverDescEl = document.getElementById('hover-desc');
const tapePreviewStripEl = document.getElementById('tape-preview-strip');
const categoryValues = Array.from(new Set(
    projectData
        .map((entry) => (typeof entry?.category === 'string' ? entry.category : ''))
        .filter(Boolean)
));
let activeCategory = CATEGORY_ALL_KEY;
let filteredTapeIndices = [];
const filteredOrderByTapeIndex = new Map();
let lastPointerClientX = Number.isFinite(window.innerWidth) ? window.innerWidth * 0.5 : 0;
let lastPointerClientY = Number.isFinite(window.innerHeight) ? window.innerHeight * 0.5 : 0;
const CATEGORY_SWITCH_HOVER_SUPPRESS_MS = 260;
const CATEGORY_SWITCH_HOVER_REARM_DISTANCE_PX = 12;
const categoryHoverGuard = {
    suppressUntil: 0,
    awaitingRearm: false,
    anchorX: 0,
    anchorY: 0
};
const TAPE_PREVIEW_MAX_IMAGES = 3;
const tapePreviewCache = new Map();
let tapePreviewRequestToken = 0;

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
let touchFocusedTape = null;

function formatCategoryLabel(category) {
    if (category === CATEGORY_ALL_KEY) return 'ALL';
    return String(category).replace(/_/g, ' ').toUpperCase();
}

function categoryMatchesProject(projectInfo, category = activeCategory) {
    if (category === CATEGORY_ALL_KEY) return true;
    return projectInfo?.category === category;
}

function rebuildFilteredTapeLookup() {
    filteredTapeIndices = [];
    filteredOrderByTapeIndex.clear();

    projectData.forEach((projectInfo, tapeIndex) => {
        if (!categoryMatchesProject(projectInfo)) return;
        filteredOrderByTapeIndex.set(tapeIndex, filteredTapeIndices.length);
        filteredTapeIndices.push(tapeIndex);
    });
}

function getTapeScrollBounds() {
    const filteredCount = filteredTapeIndices.length;
    if (filteredCount <= 0) {
        return { min: 0, max: 0 };
    }

    const { radius, count } = cachedConfig;
    if (filteredCount <= count) {
        return { min: 0, max: filteredCount - 1 };
    }

    return {
        min: radius,
        max: filteredCount - 1 - radius
    };
}

function getInitialFilteredScroll() {
    if (filteredTapeIndices.length <= 0) return 0;

    const { radius, count } = cachedConfig;
    if (filteredTapeIndices.length > count) {
        // Start at the first full window: 0..(count-1), with radius as center.
        return radius;
    }

    return (filteredTapeIndices.length - 1) / 2;
}

function getTapeIndexFromScroll(scrollValue) {
    if (filteredTapeIndices.length === 0) return null;
    const order = THREE.MathUtils.clamp(Math.round(scrollValue), 0, filteredTapeIndices.length - 1);
    return filteredTapeIndices[order] ?? null;
}

function getScrollForTapeIndex(tapeIndex, { clampToBounds = true } = {}) {
    const filteredOrder = filteredOrderByTapeIndex.get(tapeIndex);
    if (typeof filteredOrder !== 'number') return null;
    return clampToBounds ? clampTapeTargetScroll(filteredOrder) : filteredOrder;
}

function syncCategoryButtonsActiveState() {
    if (!categoryFilterBar) return;

    const categoryButtons = categoryFilterBar.querySelectorAll('.tape-category-btn');
    categoryButtons.forEach((button) => {
        const isActive = button.getAttribute('data-category') === activeCategory;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function clearTapePreviewUi() {
    tapePreviewRequestToken += 1;
    if (!tapePreviewStripEl) return;
    tapePreviewStripEl.replaceChildren();
}

function renderTapePreviewStatus(className, text) {
    if (!tapePreviewStripEl) return;

    const status = document.createElement('span');
    status.className = className;
    status.textContent = text;
    tapePreviewStripEl.replaceChildren(status);
}

function renderTapePreviewImages(imageUrls) {
    if (!tapePreviewStripEl) return;

    const validUrls = Array.isArray(imageUrls)
        ? imageUrls.filter((src) => typeof src === 'string' && src.trim().length > 0)
        : [];

    if (validUrls.length <= 0) {
        renderTapePreviewStatus('tape-preview-empty', 'NO PREVIEW IMAGES FOUND');
        return;
    }

    const previewNodes = validUrls.slice(0, TAPE_PREVIEW_MAX_IMAGES).map((src, index) => {
        const frame = document.createElement('figure');
        frame.className = 'tape-preview-thumb';

        const img = document.createElement('img');
        img.src = src;
        img.alt = `Preview ${index + 1}`;
        img.loading = 'lazy';
        img.decoding = 'async';

        frame.appendChild(img);
        return frame;
    });

    tapePreviewStripEl.replaceChildren(...previewNodes);
}

function extractPreviewImageUrlsFromPage(htmlText, pageUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const imageEls = Array.from(doc.querySelectorAll('img[src]'));
    const uniqueUrls = [];

    imageEls.forEach((imageEl) => {
        if (uniqueUrls.length >= TAPE_PREVIEW_MAX_IMAGES) return;

        const rawSrc = imageEl.getAttribute('src');
        if (!rawSrc || rawSrc.startsWith('data:')) return;

        try {
            const resolvedUrl = new URL(rawSrc, pageUrl).href;
            if (!uniqueUrls.includes(resolvedUrl)) {
                uniqueUrls.push(resolvedUrl);
            }
        } catch {
            // Ignore malformed image paths in project pages.
        }
    });

    return uniqueUrls;
}

async function getProjectPreviewImages(projectUrl) {
    if (!projectUrl || typeof projectUrl !== 'string') return [];

    let pageUrl;
    try {
        pageUrl = new URL(projectUrl, window.location.href);
    } catch {
        return [];
    }

    const cacheKey = pageUrl.href;
    if (tapePreviewCache.has(cacheKey)) {
        return tapePreviewCache.get(cacheKey);
    }

    const requestPromise = fetch(cacheKey, { cache: 'force-cache' })
        .then((response) => {
            if (!response.ok) return '';
            return response.text();
        })
        .then((htmlText) => {
            if (!htmlText) return [];
            return extractPreviewImageUrlsFromPage(htmlText, pageUrl);
        })
        .catch(() => []);

    tapePreviewCache.set(cacheKey, requestPromise);
    return requestPromise;
}

async function showTapePreviewForProject(projectInfo) {
    if (!tapePreviewStripEl) return;

    const nextToken = tapePreviewRequestToken + 1;
    tapePreviewRequestToken = nextToken;
    renderTapePreviewStatus('tape-preview-loading', 'SCANNING PROJECT FOLDER...');

    const imageUrls = await getProjectPreviewImages(projectInfo?.url);
    if (nextToken !== tapePreviewRequestToken) return;

    renderTapePreviewImages(imageUrls);
}

function armCategoryHoverGuard() {
    categoryHoverGuard.suppressUntil = performance.now() + CATEGORY_SWITCH_HOVER_SUPPRESS_MS;

    if (isCoarsePointerDevice) {
        categoryHoverGuard.awaitingRearm = false;
        return;
    }

    categoryHoverGuard.awaitingRearm = true;
    categoryHoverGuard.anchorX = lastPointerClientX;
    categoryHoverGuard.anchorY = lastPointerClientY;
}

function setActiveCategory(nextCategory, { playUiSound = true } = {}) {
    if (state.isLocked) return;

    const normalizedCategory = nextCategory === CATEGORY_ALL_KEY || categoryValues.includes(nextCategory)
        ? nextCategory
        : CATEGORY_ALL_KEY;

    if (normalizedCategory === activeCategory) return;

    activeCategory = normalizedCategory;
    rebuildFilteredTapeLookup();

// Reset outgoing tapes so filter transitions don't show split-second flip artifacts.
    tapes.forEach((tape) => {
        const isInNextCategory = filteredOrderByTapeIndex.has(tape.userData?.index);
        if (isInNextCategory) {
            tape.position.z = 0;
            return;
        }

        // Instantly hide and park above the lane so re-entry animates downward.
        tape.userData.filterBlend = 0; 
        tape.position.y = 0.4 + FILTER_HIDE_LIFT_Y;
        tape.position.z = 0;

        const hov = tape.userData?.action1;
        const flip = tape.userData?.action2;
        if (hov) {
            hov.stop();
            hov.reset();
        }
        if (flip) {
            flip.stop();
            flip.reset();
        }

        tape.rotation.set(0, 0, 0);
    });
    const nextScroll = getInitialFilteredScroll();

    state.currentScroll = nextScroll;
    state.targetScroll = nextScroll;

    state.activeTape = null;
    state.previousTape = null;
    touchFocusedTape = null;
    if (state.selectedTape && !filteredOrderByTapeIndex.has(state.selectedTape.userData?.index)) {
        state.selectedTape = null;
    }

    if (hoverUI) {
        hoverUI.classList.remove('visible');
    }
    clearTapePreviewUi();
    armCategoryHoverGuard();

    syncCategoryButtonsActiveState();
    if (playUiSound) {
        playTapeUiSfx();
    }
}

function buildCategoryFilterUi() {
    if (!categoryFilterBar) return;

    const categories = [CATEGORY_ALL_KEY, ...categoryValues];
    categoryFilterBar.innerHTML = categories.map((category) => {
        const label = formatCategoryLabel(category);
        const isActive = category === activeCategory;
        return `<button type="button" class="tape-category-btn${isActive ? ' active' : ''}" data-category="${category}" aria-pressed="${isActive ? 'true' : 'false'}">${label}</button>`;
    }).join('');

    categoryFilterBar.addEventListener('click', (event) => {
        const button = event.target.closest('.tape-category-btn');
        if (!button || !categoryFilterBar.contains(button)) return;

        const requestedCategory = button.getAttribute('data-category') || CATEGORY_ALL_KEY;
        setActiveCategory(requestedCategory);
    });
}

rebuildFilteredTapeLookup();
buildCategoryFilterUi();
const initialFilteredScroll = getInitialFilteredScroll();
state.currentScroll = initialFilteredScroll;
state.targetScroll = initialFilteredScroll;

let swooshSfx = null;
let swooshPrimed = false;
const SWOOSH_START_OFFSET_SEC = 0.1;
let staticAmbienceSfx = null;
let buzzLayerSfx = null;
let staticAmbiencePrimed = false;
let staticAmbienceUnlockBound = false;
let buzzRearmGestureListenerBound = false;
const STATIC_PROJECTS_ZOOM_THRESHOLD = 0.45;
const STATIC_BUZZ = {
    baseVolume: 0.02,
    maxVolumeBoost: 0.012,
    baseRate: 0.98,
    maxRateBoost: 0.2,
    layerMaxVolume: 0.05,
    layerBaseRate: 0.95,
    layerRateBoost: 0.24,
    inZoneFloorVolume: 0.006,
    minSpeedPxPerMs: 0.12,
    maxSpeedPxPerMs: 1.4,
    decayPerSecond: 2.4,
    motionIntensityGain: 0.95,
    motionCurveExponent: 1.45,
    sampleMinIntervalMs: 10
};
const STATIC_BUZZ_ZONE = {
    xPct: 0.39,
    yPct: 0.24,
    widthPct: 0.22,
    heightPct: 0.4
};
let staticBuzzIntensity = 0;
let staticBuzzLastX = null;
let staticBuzzLastY = null;
let staticBuzzLastSampleTime = 0;
let staticBuzzPointerInZone = false;

function isMainPageBuzzState() {
    return activeSequenceKey === 'default'
        && state.targetZoom <= STATIC_PROJECTS_ZOOM_THRESHOLD;
}

function resetStaticBuzzTracking() {
    staticBuzzIntensity = 0;
    resetStaticBuzzPointerTracking();
}

function resetStaticBuzzPointerTracking() {
    staticBuzzPointerInZone = false;
    staticBuzzLastX = null;
    staticBuzzLastY = null;
    staticBuzzLastSampleTime = 0;
}

function getStaticBuzzZoneRect() {
    const left = window.innerWidth * STATIC_BUZZ_ZONE.xPct;
    const top = window.innerHeight * STATIC_BUZZ_ZONE.yPct;
    const width = window.innerWidth * STATIC_BUZZ_ZONE.widthPct;
    const height = window.innerHeight * STATIC_BUZZ_ZONE.heightPct;

    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height
    };
}

function isInsideStaticBuzzZone(clientX, clientY) {
    const zone = getStaticBuzzZoneRect();
    return clientX >= zone.left && clientX <= zone.right && clientY >= zone.top && clientY <= zone.bottom;
}

function shouldPlayStaticAmbience() {
    return isMainPageBuzzState();
}

function syncStaticAmbience() {
    if (!staticAmbienceSfx && !buzzLayerSfx) return;

    // Keep ambience loops running once primed to avoid audible stop/restart seams.
    if (staticAmbiencePrimed) {
        if (staticAmbienceSfx && staticAmbienceSfx.paused) {
            staticAmbienceSfx.play().catch(() => {});
        }
        if (buzzLayerSfx && buzzLayerSfx.paused) {
            buzzLayerSfx.play().catch(() => {});
        }
    }
}

function primeStaticAmbienceOnFirstGesture() {
    if (staticAmbiencePrimed || !staticAmbienceSfx || staticAmbienceUnlockBound) return;
    staticAmbienceUnlockBound = true;

    const eventOptions = { capture: true };
    const unlockEvents = ['pointerdown', 'touchstart', 'wheel', 'keydown'];

    const cleanupUnlockListeners = () => {
        staticAmbienceUnlockBound = false;
        unlockEvents.forEach((eventName) => {
            window.removeEventListener(eventName, unlockFromGesture, eventOptions);
        });
    };

    const unlockFromGesture = () => {
        if (staticAmbiencePrimed || !staticAmbienceSfx) {
            cleanupUnlockListeners();
            return;
        }

        staticAmbiencePrimed = true;
        if (staticAmbienceSfx && staticAmbienceSfx.paused) {
            staticAmbienceSfx.play().catch(() => {});
        }
        if (buzzLayerSfx && buzzLayerSfx.paused) {
            buzzLayerSfx.play().catch(() => {});
        }
        syncStaticAmbience();
        cleanupUnlockListeners();
    };

    unlockEvents.forEach((eventName) => {
        window.addEventListener(eventName, unlockFromGesture, eventOptions);
    });
}

function bootstrapStaticAmbienceAutoplay() {
    if (!staticAmbienceSfx && !buzzLayerSfx) return;

    const ambiencePlayers = [staticAmbienceSfx, buzzLayerSfx].filter(Boolean);
    ambiencePlayers.forEach((audioObj) => {
        audioObj.muted = true;
    });

    Promise.all(ambiencePlayers.map((audioObj) => audioObj.play()))
        .then(() => {
            staticAmbiencePrimed = true;
            ambiencePlayers.forEach((audioObj) => {
                audioObj.muted = false;
            });
            syncStaticAmbience();
        })
        .catch(() => {
            ambiencePlayers.forEach((audioObj) => {
                audioObj.muted = false;
            });
            primeStaticAmbienceOnFirstGesture();
            syncStaticAmbience();
        });
}

function registerStaticBuzzFromPointerMove(clientX, clientY) {
    if (!isMainPageBuzzState()) {
        resetStaticBuzzTracking();
        return;
    }

    if (!isInsideStaticBuzzZone(clientX, clientY)) {
        // Keep intensity decay-driven so leaving the zone fades out naturally.
        resetStaticBuzzPointerTracking();
        return;
    }

    staticBuzzPointerInZone = true;

    const now = performance.now();

    if (staticBuzzLastX === null || staticBuzzLastY === null || staticBuzzLastSampleTime === 0) {
        staticBuzzLastX = clientX;
        staticBuzzLastY = clientY;
        staticBuzzLastSampleTime = now;
        return;
    }

    const dt = now - staticBuzzLastSampleTime;
    if (dt < STATIC_BUZZ.sampleMinIntervalMs) return;

    const distance = Math.hypot(clientX - staticBuzzLastX, clientY - staticBuzzLastY);
    const speedPxPerMs = distance / Math.max(dt, 1);

    const normalizedSpeed = THREE.MathUtils.clamp(
        (speedPxPerMs - STATIC_BUZZ.minSpeedPxPerMs) /
        Math.max(0.001, STATIC_BUZZ.maxSpeedPxPerMs - STATIC_BUZZ.minSpeedPxPerMs),
        0,
        1
    );

    if (normalizedSpeed > 0) {
        const flybyRandomness = 0.85 + (Math.random() * 0.1);
        staticBuzzIntensity = Math.max(
            staticBuzzIntensity,
            normalizedSpeed * flybyRandomness * STATIC_BUZZ.motionIntensityGain
        );
    }

    staticBuzzLastX = clientX;
    staticBuzzLastY = clientY;
    staticBuzzLastSampleTime = now;
}

function applyStaticBuzzModulation(delta) {
    if (!staticAmbienceSfx && !buzzLayerSfx) return;

    if (!shouldPlayStaticAmbience()) {
        resetStaticBuzzTracking();
        if (staticAmbienceSfx) {
            staticAmbienceSfx.playbackRate = STATIC_BUZZ.baseRate;
            staticAmbienceSfx.volume = STATIC_BUZZ.baseVolume;
        }
        if (buzzLayerSfx) {
            buzzLayerSfx.playbackRate = STATIC_BUZZ.layerBaseRate;
            buzzLayerSfx.volume = 0;
        }
        return;
    }

    staticBuzzIntensity = Math.max(0, staticBuzzIntensity - (STATIC_BUZZ.decayPerSecond * delta));
    const buzz = THREE.MathUtils.clamp(staticBuzzIntensity, 0, 1);
    const flyby = Math.pow(buzz, STATIC_BUZZ.motionCurveExponent);

    const shimmer = buzz > 0.02
        ? Math.sin(performance.now() * 0.04) * 0.008 * buzz
        : 0;

    if (staticAmbienceSfx) {
        staticAmbienceSfx.playbackRate = THREE.MathUtils.clamp(
            STATIC_BUZZ.baseRate + (STATIC_BUZZ.maxRateBoost * buzz) + shimmer,
            0.5,
            2.0
        );
        staticAmbienceSfx.volume = THREE.MathUtils.clamp(
            STATIC_BUZZ.baseVolume + (STATIC_BUZZ.maxVolumeBoost * buzz),
            0,
            1
        );
    }

    if (buzzLayerSfx) {
        const flutter = 0.88 + (Math.sin(performance.now() * 0.07) * 0.12);
        const zoneFloor = staticBuzzPointerInZone ? STATIC_BUZZ.inZoneFloorVolume : 0;
        const dynamicLayerVolume = STATIC_BUZZ.layerMaxVolume * flyby * flutter;
        buzzLayerSfx.playbackRate = THREE.MathUtils.clamp(
            STATIC_BUZZ.layerBaseRate + (STATIC_BUZZ.layerRateBoost * flyby),
            0.5,
            2.0
        );
        buzzLayerSfx.volume = THREE.MathUtils.clamp(
            Math.max(zoneFloor, dynamicLayerVolume),
            0,
            1
        );
    }
}

function playSwooshSfx() {
    if (!swooshSfx) return;

    const duration = Number.isFinite(swooshSfx.duration) ? swooshSfx.duration : 0;
    if (duration > SWOOSH_START_OFFSET_SEC + 0.01) {
        swooshSfx.currentTime = SWOOSH_START_OFFSET_SEC;
    } else {
        swooshSfx.currentTime = 0;
    }

    swooshSfx.play().catch(() => {});
}

function primeSwooshOnFirstGesture() {
    if (swooshPrimed || !swooshSfx) return;

    window.addEventListener('pointerdown', () => {
        if (swooshPrimed || !swooshSfx) return;
        swooshPrimed = true;

        const previousMuted = swooshSfx.muted;
        swooshSfx.muted = true;
        swooshSfx.currentTime = 0;

        swooshSfx.play()
            .then(() => {
                swooshSfx.pause();
                swooshSfx.currentTime = 0;
                swooshSfx.muted = previousMuted;
            })
            .catch(() => {
                swooshSfx.muted = previousMuted;
            });
    }, { once: true });
}

function zoomToTapesWithSwoosh() {
    if (state.targetZoom < 1) {
        playSwooshSfx();
    }
    state.targetZoom = 1;
}

let projectOpenTimeoutId = null;
let flipTimeoutId = null;
let zoomOutTimeoutId = null;
const LOCK_CENTER_SCROLL_SPEED = 0.04;
const LOCK_FOCUS_SCROLL_SPEED = 0.03;
const LOCK_CENTER_EPSILON = 0.02;
const LOCK_CENTER_MAX_WAIT_MS = 1000;
const LOCK_CENTER_POLL_MS = 16;

function waitForLockedCenter({ tape, targetScroll, onReady }) {
    if (!tape || typeof onReady !== 'function') return;
    if (typeof targetScroll !== 'number') {
        onReady();
        return;
    }

    const startedAt = performance.now();

    const pollCenter = () => {
        if (!state.isLocked || state.selectedTape !== tape) return;

        const scrollError = Math.abs(state.currentScroll - targetScroll);
        if (scrollError <= LOCK_CENTER_EPSILON) {
            onReady();
            return;
        }

        if (performance.now() - startedAt >= LOCK_CENTER_MAX_WAIT_MS) {
            onReady();
            return;
        }

        setTimeout(pollCenter, LOCK_CENTER_POLL_MS);
    };

    pollCenter();
}

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
const FILTER_HIDE_LIFT_Y = 1.25;
const FILTER_BLEND_SPEED = 0.12;
const FILTER_RENDER_EPSILON = 0.02;
const FILTER_OUT_RENDER_EPSILON = 0.08;
const FILTER_OUT_OPACITY_EXPONENT = 2.0;
const HOVER_FALLBACK_MAX_DIST_X = 0.2;
const HOVER_FALLBACK_MAX_DIST_Y = 0.4;


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
    zoomStart: 0.70,
    zoomFull: 0.90,
    radiusNdc: 0.1,
    softness: 0.70,
    maxAlpha: 0.95
};

const SEQUENCE_MOUSE_TRAIL = {
    maxPoints: isCoarsePointerDevice ? 8 : 14,
    lifetimeMs: isCoarsePointerDevice ? 280 : 420,
    minSampleDistance: 0.01,
    minSampleIntervalMs: isCoarsePointerDevice ? 18 : 14,
    tailOpacity: 0.55,
    tailRadiusStart: isCoarsePointerDevice ? 0.7 : 0.9,
    tailRadiusEnd: isCoarsePointerDevice ? 0.55 : 0.7
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
const blendMaskCanvas = document.createElement('canvas');
const blendMaskCtx = blendMaskCanvas.getContext('2d');
const sequenceMouseTrail = [];
let hasSequenceMousePosition = false;
let lastSequenceTrailSampleTime = 0;

function updateSequenceMouseTrail(clientX, clientY) {
    const now = performance.now();
    const u = THREE.MathUtils.clamp(clientX / window.innerWidth, 0, 1);
    const v = THREE.MathUtils.clamp(clientY / window.innerHeight, 0, 1);

    hasSequenceMousePosition = true;

    const last = sequenceMouseTrail[sequenceMouseTrail.length - 1];
    const hasInterval = (now - lastSequenceTrailSampleTime) >= SEQUENCE_MOUSE_TRAIL.minSampleIntervalMs;
    const hasDistance = !last || Math.hypot(u - last.u, v - last.v) >= SEQUENCE_MOUSE_TRAIL.minSampleDistance;

    if (!last || hasInterval || hasDistance) {
        sequenceMouseTrail.push({ u, v, t: now });
        if (sequenceMouseTrail.length > SEQUENCE_MOUSE_TRAIL.maxPoints) {
            sequenceMouseTrail.splice(0, sequenceMouseTrail.length - SEQUENCE_MOUSE_TRAIL.maxPoints);
        }
        lastSequenceTrailSampleTime = now;
    } else {
        last.u = u;
        last.v = v;
        last.t = now;
    }
}

function pruneSequenceMouseTrail(now) {
    const oldestAllowed = now - SEQUENCE_MOUSE_TRAIL.lifetimeMs;
    while (sequenceMouseTrail.length > 0 && sequenceMouseTrail[0].t < oldestAllowed) {
        sequenceMouseTrail.shift();
    }
}

function activateSectionSequence(sequenceKey) {
    activeSequenceKey = sequenceKey;
    preloadSequenceByKey(sequenceKey, false);
    sequenceTimelineFrame = 0;
    sectionIntroPlayed = false;
    lastDrawnSequenceKey = null;
    lastDrawnFrame = -1;
}

// --- ADD THIS NEW HELPER ---
function activateDefaultSequence({ playPowerOn = true, resetFrame = true, forceRestartIfDefault = false } = {}) {
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
    } else if (forceRestartIfDefault) {
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
    // Returning "home" from section pages only needs one power-on pass.
    // Keep deferred replay only for actions that need a post-intro step (e.g. "projects").
    pendingMenuAction = action === 'home' ? null : action;
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
    if (DISABLE_PHONE_SEQUENCE_BLEND) return;
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
    if (DISABLE_PHONE_SEQUENCE_BLEND) return 0;
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
    if (blendMaskCanvas.width !== seqCanvas.width || blendMaskCanvas.height !== seqCanvas.height) {
        blendMaskCanvas.width = seqCanvas.width;
        blendMaskCanvas.height = seqCanvas.height;
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

    const now = performance.now();
    pruneSequenceMouseTrail(now);

    if (!blendMaskCtx) return;
    blendMaskCtx.clearRect(0, 0, blendMaskCanvas.width, blendMaskCanvas.height);

    const drawMaskSpot = (cx, cy, alphaScale, radiusScale) => {
        const safeRadiusScale = Math.max(0.2, radiusScale);
        const outerRadius = radiusPx * safeRadiusScale;
        const innerRadius = innerRadiusPx * safeRadiusScale;
        const alpha = THREE.MathUtils.clamp(blendAlpha * SEQUENCE_BLEND.maxAlpha * alphaScale, 0, 1);
        if (alpha <= 0.001) return;

        const gradient = blendMaskCtx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
        gradient.addColorStop(0, `rgba(0,0,0,${alpha})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        blendMaskCtx.fillStyle = gradient;
        blendMaskCtx.fillRect(cx - outerRadius, cy - outerRadius, outerRadius * 2, outerRadius * 2);
    };

    if (hasSequenceMousePosition) {
        drawMaskSpot(mx, my, 1, 1);
    }

    for (let i = sequenceMouseTrail.length - 1; i >= 0; i--) {
        const sample = sequenceMouseTrail[i];
        const age = now - sample.t;
        const ageNorm = THREE.MathUtils.clamp(age / SEQUENCE_MOUSE_TRAIL.lifetimeMs, 0, 1);
        if (ageNorm >= 1) continue;

        const fade = 1 - ageNorm;
        const sampleRadiusScale = THREE.MathUtils.lerp(
            SEQUENCE_MOUSE_TRAIL.tailRadiusStart,
            SEQUENCE_MOUSE_TRAIL.tailRadiusEnd,
            fade
        );
        const sampleAlphaScale = SEQUENCE_MOUSE_TRAIL.tailOpacity * fade * fade;
        drawMaskSpot(
            sample.u * blendCanvas.width,
            sample.v * blendCanvas.height,
            sampleAlphaScale,
            sampleRadiusScale
        );
    }

    blendCtx.globalCompositeOperation = 'destination-in';
    blendCtx.drawImage(blendMaskCanvas, 0, 0, blendCanvas.width, blendCanvas.height);
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
blendMaskCanvas.width = window.innerWidth;
blendMaskCanvas.height = window.innerHeight;
preloadSequenceByKey('default', true);

// --- 3. GLOBAL SCENE ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 1000);

const renderer = new THREE.WebGLRenderer({
    canvas: document.getElementById("bg-canvas"),
    antialias: !isCoarsePointerDevice,
    alpha: true,
    premultipliedAlpha: false // Keeps alpha compositing predictable over the sequence canvas
});
renderer.setClearColor(0x000000, 0);

const perfProfile = (() => {
    const cores = navigator.hardwareConcurrency || 8;
    const memory = navigator.deviceMemory || 8;
    const smallScreen = Math.min(window.innerWidth, window.innerHeight) < 800;
    const lowEnd = cores <= 4 || memory <= 4 || smallScreen || isCoarsePointerDevice || prefersReducedMotion;

    return {
        lowEnd,
        pixelRatioCap: lowEnd ? 1 : 2
    };
})();

const MOBILE_RENDER_SCALE = isCoarsePointerDevice ? 0.72 : 1;

function updateRendererResolution() {
    const renderWidth = Math.max(1, Math.floor(window.innerWidth * MOBILE_RENDER_SCALE));
    const renderHeight = Math.max(1, Math.floor(window.innerHeight * MOBILE_RENDER_SCALE));
    renderer.setSize(renderWidth, renderHeight, false);
}

updateRendererResolution();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, perfProfile.pixelRatioCap));
renderer.shadowMap.enabled = !perfProfile.lowEnd;
if (renderer.shadowMap.enabled) {
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

setupSceneLights(scene);

// --- 4. SCENE DATA ---
const mouse = new THREE.Vector2(-100, -100);
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
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

function isTapeInteractable(tape) {
    if (!tape || !tape.userData) return false;
    if (!tape.visible) return false;
    return typeof tape.userData.filteredOrder === 'number' && tape.userData.filteredOrder >= 0;
}

function getTapeAtClientPosition(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    if (state.zoom <= 0.9) return null;

    pointerNdc.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNdc.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(tapes, true);
    if (hits.length === 0) return null;

    for (const hit of hits) {
        const tapeRoot = getTapeRootFromObject(hit.object);
        if (isTapeInteractable(tapeRoot)) {
            return tapeRoot;
        }
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
            filteredOrder: -1,
            filterBlend: 1,
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
            pendingMenuAction = null;
            pendingScrollDelta = 0;
            pendingSectionSequenceKey = null;
            activateDefaultSequence({ playPowerOn: true, resetFrame: true, forceRestartIfDefault: true });
            drawSequence(0);
            state.targetZoom = 0;
            break;
        case "projects":
            pendingSectionSequenceKey = null;
            activateDefaultSequence(); // <-- Updated
            drawSequence(sequenceTimelineFrame / SEQUENCE_TIMELINE.zoomedLoopEndFrame);
            zoomToTapesWithSwoosh();
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
    lastPointerClientX = e.clientX;
    lastPointerClientY = e.clientY;

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    if (!isCoarsePointerDevice) {
        updateSequenceMouseTrail(e.clientX, e.clientY);
    }
    if (!DISABLE_PHONE_BUZZ_AUDIO) {
        registerStaticBuzzFromPointerMove(e.clientX, e.clientY);
    }

    if (dragState.awaitingHoverRearm) {
        if (Math.abs(e.clientX - dragState.releaseX) >= DRAG_HOVER_REARM_DISTANCE_PX) {
            dragState.awaitingHoverRearm = false;
        }
    }

    if (categoryHoverGuard.awaitingRearm) {
        const movedDistance = Math.hypot(
            e.clientX - categoryHoverGuard.anchorX,
            e.clientY - categoryHoverGuard.anchorY
        );

        if (movedDistance >= CATEGORY_SWITCH_HOVER_REARM_DISTANCE_PX) {
            categoryHoverGuard.awaitingRearm = false;
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
    const { min, max } = getTapeScrollBounds();
    return THREE.MathUtils.clamp(value, min, max);
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

    zoomToTapesWithSwoosh();

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
        if (isCoarsePointerDevice) {
            // Phone swipe should settle on a tape slot, not between tapes.
            const snappedTarget = clampTapeTargetScroll(Math.round(state.targetScroll));
            state.targetScroll = snappedTarget;
        }

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
    const { min, max } = getTapeScrollBounds();
    const now = performance.now();
    const zoomSettledIn = state.zoom >= ZOOM_SCROLL_READY;
    const atFirstTape = state.targetScroll <= min + 0.001;

    if (deltaY > 5) {
        // Don't advance tape index until the camera has mostly finished zooming in.
        zoomOutIntent = 0;
        if (state.targetZoom < 1) {
            zoomToTapesWithSwoosh();
            zoomInScrollUnlockAt = now + ZOOM_IN_SCROLL_LOCK_MS;
            return;
        } else if (now < zoomInScrollUnlockAt) {
            return;
        } else if (!zoomSettledIn) {
            return;
        } else if (state.targetScroll < max - 0.001) {
            state.targetScroll = clampTapeTargetScroll(state.targetScroll + 1);
            playTapeUiSfx();
        }
    } else if (deltaY < -5) {
        zoomInScrollUnlockAt = 0;
        if (!zoomSettledIn) {
            state.targetZoom = 0;
            zoomOutIntent = 0;
            return;
        }

        if (state.targetScroll > min + 0.001) {
            state.targetScroll = clampTapeTargetScroll(state.targetScroll - 1);
            playTapeUiSfx();
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

function handleScrollInputDelta(deltaY) {
    if (scrollCooldown) return;
    if (Math.abs(deltaY) <= 5) return;

    // If user scrolls while in About/Contact, play default 0-20 first, then apply scroll intent.
    if (activeSequenceKey !== 'default') {
        pendingSectionSequenceKey = null;
        pendingMenuAction = null;
        pendingScrollDelta = deltaY;
        activateDefaultSequence({ playPowerOn: true, resetFrame: true });
        state.targetZoom = 0;
        triggerCooldown();
        return;
    }

    // While default power-on is playing, queue latest scroll and apply after intro completes.
    if (!defaultPowerOnPlayed) {
        pendingScrollDelta = deltaY;
        triggerCooldown();
        return;
    }

    const prevZoom = state.targetZoom;
    const prevScroll = state.targetScroll;
    applyWheelNavigation(deltaY);

    if (state.targetZoom !== prevZoom || state.targetScroll !== prevScroll) {
        triggerCooldown();
    }
}

window.addEventListener("wheel", e => {
    handleScrollInputDelta(e.deltaY);
});

if (isCoarsePointerDevice) {
    let touchScrollLastX = null;
    let touchScrollLastY = null;
    let touchScrollAccumY = 0;
    const TOUCH_SCROLL_STEP_PX = 22;

    window.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        touchScrollLastX = touch.clientX;
        touchScrollLastY = touch.clientY;
        touchScrollAccumY = 0;
    }, { passive: true });

    window.addEventListener('touchmove', (event) => {
        if (event.touches.length !== 1 || touchScrollLastY === null || touchScrollLastX === null) return;
        const touch = event.touches[0];

        const deltaX = touch.clientX - touchScrollLastX;
        const deltaY = touch.clientY - touchScrollLastY;
        touchScrollLastX = touch.clientX;
        touchScrollLastY = touch.clientY;

        // Ignore mostly horizontal gestures so drag interactions remain natural.
        if (Math.abs(deltaY) < Math.abs(deltaX) * 1.15) return;

        // Swipe up should behave like wheel scroll down (zoom/move into tapes).
        touchScrollAccumY += -deltaY;
        if (Math.abs(touchScrollAccumY) < TOUCH_SCROLL_STEP_PX) return;

        handleScrollInputDelta(touchScrollAccumY);
        touchScrollAccumY = 0;
        event.preventDefault();
    }, { passive: false });

    const resetTouchScrollState = () => {
        touchScrollLastX = null;
        touchScrollLastY = null;
        touchScrollAccumY = 0;
    };

    window.addEventListener('touchend', resetTouchScrollState, { passive: true });
    window.addEventListener('touchcancel', resetTouchScrollState, { passive: true });
}

function triggerCooldown() {
    scrollCooldown = true;
    setTimeout(() => { scrollCooldown = false; }, SCROLL_DELAY);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateRendererResolution();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, perfProfile.pixelRatioCap));
    
    if (seqCanvas) {
        seqCanvas.width = window.innerWidth;
        seqCanvas.height = window.innerHeight;
    }
    blendCanvas.width = window.innerWidth;
    blendCanvas.height = window.innerHeight;
    blendMaskCanvas.width = window.innerWidth;
    blendMaskCanvas.height = window.innerHeight;

    cachedConfig = getVisibleConfig();
    state.targetScroll = clampTapeTargetScroll(state.targetScroll);
    state.currentScroll = clampTapeTargetScroll(state.currentScroll);
});

window.addEventListener('click', (event) => {
    if (dragState.awaitingHoverRearm) return;
    if (performance.now() < dragState.suppressClickUntil) return;

    if (state.zoom > 0.9 && !state.isLocked) {
        const clickedTape = getTapeAtClientPosition(event.clientX, event.clientY) || state.activeTape;
        if (!isTapeInteractable(clickedTape)) return;

        if (isCoarsePointerDevice && touchFocusedTape !== clickedTape) {
            // On touch devices: first tap focuses/hovers, second tap inserts.
            touchFocusedTape = clickedTape;
            state.scrollSpeed = LOCK_FOCUS_SCROLL_SPEED;
            const focusScroll = getScrollForTapeIndex(clickedTape.userData.index, { clampToBounds: false });
            state.targetScroll = focusScroll ?? state.targetScroll;
            if (state.previousTape === clickedTape) {
                // Force hover branch to run so first tap replays hover animation/UI.
                state.previousTape = null;
            }
            state.activeTape = clickedTape;
            return;
        }

        touchFocusedTape = null;
        state.isLocked = true;
        playSound(projectSelectSfx);
        setTimeout(() => playSound(tapeInSfx), 250);
        
        // Use the smooth glide speed
        state.scrollSpeed = LOCK_CENTER_SCROLL_SPEED; 
        state.selectedTape = clickedTape;
        const selectedScroll = getScrollForTapeIndex(clickedTape.userData.index, { clampToBounds: false });
        state.targetScroll = selectedScroll ?? state.targetScroll;

        const lockStartedAt = performance.now();

        // Keep the fix that instantly straightens the tape!
        clickedTape.rotation.set(0, 0, 0);

        waitForLockedCenter({
            tape: clickedTape,
            targetScroll: selectedScroll,
            onReady: () => {
                if (!state.isLocked || state.selectedTape !== clickedTape) return;

                const elapsed = performance.now() - lockStartedAt;
                const hov = clickedTape.userData.action1;
                const flip = clickedTape.userData.action2;

                // Keep original pacing as closely as possible relative to initial click time.
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
                }, Math.max(0, 400 - elapsed));

                projectOpenTimeoutId = setTimeout(() => {
                    projectOpenTimeoutId = null;
                    const selected = state.selectedTape;
                    if (!selected) return;
                    const selectedProjectData = selected.userData.projectInfo;
                    openProjectPage(selectedProjectData);
                }, Math.max(0, 1500 - elapsed));
            }
        });
    }
});

function rearmBuzzAfterBrowserNavigation({ fromHistoryRestore = false } = {}) {
    if (DISABLE_PHONE_BUZZ_AUDIO) return;

    resetStaticBuzzTracking();
    syncStaticAmbience();

    // Some browsers resume media/state a beat later after history navigation.
    setTimeout(() => syncStaticAmbience(), 120);
    setTimeout(() => syncStaticAmbience(), 420);

    if (!staticAmbiencePrimed) {
        primeStaticAmbienceOnFirstGesture();
    }

    if (!buzzRearmGestureListenerBound) {
        buzzRearmGestureListenerBound = true;
        window.addEventListener('pointerdown', () => {
            buzzRearmGestureListenerBound = false;
            syncStaticAmbience();
        }, { once: true });
    }

    if (fromHistoryRestore) {
        requestAnimationFrame(() => syncStaticAmbience());
    }
}

window.addEventListener('pageshow', (event) => {
    const navEntry = (typeof performance.getEntriesByType === 'function')
        ? performance.getEntriesByType('navigation')[0]
        : null;
    const isHistoryNavigation = event.persisted || navEntry?.type === 'back_forward';
    if (!isHistoryNavigation) return;

    restoreArchiveInteractionState();
    rearmBuzzAfterBrowserNavigation({ fromHistoryRestore: true });
});

document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    rearmBuzzAfterBrowserNavigation();
});

// --- TV HOTSPOT LOGIC ---
const hotspotContainer = document.getElementById('hotspot-container');

// 1. Wire up the clicks (Power is removed)
if (isCoarsePointerDevice) {
    hotspotContainer?.classList.add('disable-tv-hotspots');
} else {
    document.getElementById('hotspot-menu')?.addEventListener('click', () => handleSystemAction('home'));
    document.getElementById('hotspot-about')?.addEventListener('click', () => handleSystemAction('about'));
    document.getElementById('hotspot-projects')?.addEventListener('click', () => handleSystemAction('projects'));
    document.getElementById('hotspot-contact')?.addEventListener('click', () => handleSystemAction('contact'));
}

// 2. Hide them when zooming in (Add this logic inside your Animate loop)

// --- 8. ANIMATE ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const zoomLerpFactor = getFrameRateIndependentLerpFactor(0.06, delta);
    const scrollLerpFactor = getFrameRateIndependentLerpFactor(state.scrollSpeed, delta);
    const tapeRotationLerpFactor = getFrameRateIndependentLerpFactor(0.1, delta);
    const cameraLerpFactor = getFrameRateIndependentLerpFactor(0.04, delta);
    const sequenceTransitionLerpFactor = getFrameRateIndependentLerpFactor(0.2, delta);
    const highlightColorLerpFactor = getFrameRateIndependentLerpFactor(TAPE_HIGHLIGHT.colorLerp, delta);
    const highlightEmissiveLerpFactor = getFrameRateIndependentLerpFactor(TAPE_HIGHLIGHT.emissiveLerp, delta);
    if (categoryHoverGuard.awaitingRearm && (isCoarsePointerDevice || state.zoom <= 0.9)) {
        categoryHoverGuard.awaitingRearm = false;
    }

    const hoverSuppressed = dragState.moved
        || dragState.awaitingHoverRearm
        || performance.now() < dragState.hoverSuppressUntil
        || categoryHoverGuard.awaitingRearm
        || performance.now() < categoryHoverGuard.suppressUntil;

    // 1. SCROLL WHEEL OVERRIDE
    // If the mouse wheel pushes us towards the tapes (zoom > 0.5), force the default sequence.
    if (state.targetZoom > 0.5) {
        pendingSectionSequenceKey = null;
        if (activeSequenceKey !== 'default') {
            activateDefaultSequence({ playPowerOn: false, resetFrame: true });
        }
    }

    // 2. Smooth zoom lerp
    state.zoom = THREE.MathUtils.lerp(state.zoom, state.targetZoom, zoomLerpFactor);
    syncStaticAmbience();
    applyStaticBuzzModulation(delta);

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

    if (categoryFilterBar) {
        const shouldShowCategoryFilter = activeSequenceKey === 'default'
            && defaultPowerOnPlayed
            && state.zoom > 0.68
            && state.targetZoom > 0.62
            && categoryValues.length > 0;
        categoryFilterBar.classList.toggle('visible', shouldShowCategoryFilter);

        const shouldFadeCategoryFilter = !!state.activeTape && state.zoom > 0.9 && !state.isLocked && !hoverSuppressed;
        categoryFilterBar.classList.toggle('hover-fade', shouldShowCategoryFilter && shouldFadeCategoryFilter);
    }

    // 3. APPLY DEFERRED SEQUENCE
    // Only switch to About/Contact once the zoom-out animation has settled completely.
    if (pendingSectionSequenceKey && state.targetZoom === 0 && state.zoom < 0.03) {
        activateSectionSequence(pendingSectionSequenceKey);
        pendingSectionSequenceKey = null;
    }

    // 4. SCROLL TAPES
    state.currentScroll = THREE.MathUtils.lerp(state.currentScroll, state.targetScroll, scrollLerpFactor);

    const { radius } = cachedConfig;
    const center = Math.round(state.currentScroll);
    const visibleTapes = [];

    let currentFrameActiveTape = null;
    let currentFrameMinDist = 999;

    tapes.forEach((tape) => {
        const filteredOrder = filteredOrderByTapeIndex.get(tape.userData.index);
        tape.userData.filteredOrder = typeof filteredOrder === 'number' ? filteredOrder : -1;

        const isInFilteredCategory = tape.userData.filteredOrder >= 0;
        const isInWindow = isInFilteredCategory
            && tape.userData.filteredOrder >= center - radius
            && tape.userData.filteredOrder <= center + radius;

        const filterLerpFactor = getFrameRateIndependentLerpFactor(FILTER_BLEND_SPEED, delta);
        const targetFilterBlend = isInFilteredCategory ? 1 : 0;
        tape.userData.filterBlend = THREE.MathUtils.lerp(tape.userData.filterBlend, targetFilterBlend, filterLerpFactor);
        if (Math.abs(tape.userData.filterBlend - targetFilterBlend) < 0.002) {
            tape.userData.filterBlend = targetFilterBlend;
        }

        const filterBlend = THREE.MathUtils.clamp(tape.userData.filterBlend, 0, 1);
        const shouldRenderTape = isInWindow || (!isInFilteredCategory && filterBlend > FILTER_OUT_RENDER_EPSILON);
        tape.visible = shouldRenderTape;
        if (!shouldRenderTape) return;

        if (isInFilteredCategory) {
            tape.position.x = (tape.userData.filteredOrder - state.currentScroll) * tapeSpacing;
            if (tape.userData.mixer) tape.userData.mixer.update(delta);
            visibleTapes.push(tape);
        }

        const targetY = 0.4 + ((1 - filterBlend) * FILTER_HIDE_LIFT_Y);
        tape.position.y = THREE.MathUtils.lerp(tape.position.y, targetY, filterLerpFactor);
        tape.position.z = 0;
        
        // --- THE NEW FIX ---
        // Physically scale the tape down instead of making it transparent!
        // This avoids all 3D glass/hollow glitches completely.
        const scaleVal = Math.max(0.001, filterBlend); 
        tape.scale.set(scaleVal, scaleVal, scaleVal);

        const mats = tape.userData.highlightMats || [];
        mats.forEach((mat) => {
            if (!mat) return;
            
            // Lock the material so it is PERMANENTLY solid and opaque. 
            // No more weird x-ray ghost tapes!
            if (mat.transparent !== false) {
                mat.transparent = false;
                mat.opacity = 1.0;
                mat.depthWrite = true;
                mat.needsUpdate = true;
            }
        });
        if (state.zoom > 0.9 && !hoverSuppressed) {
            tape.getWorldPosition(tempVec);
            tempVec.project(camera);

            const distX = Math.abs(mouse.x - tempVec.x);
            const distY = Math.abs(mouse.y - tempVec.y);

            if (distY < HOVER_FALLBACK_MAX_DIST_Y
                && distX < HOVER_FALLBACK_MAX_DIST_X
                && distX < currentFrameMinDist) {
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

    let nextActiveTape = hoverSuppressed ? null : (hoveredTapeFromRay || (state.zoom > 0.9 ? currentFrameActiveTape : null));

    if (isCoarsePointerDevice) {
        if (state.zoom <= 0.9 || state.isLocked || hoverSuppressed) {
            touchFocusedTape = null;
            nextActiveTape = null;
        } else if (isTapeInteractable(touchFocusedTape)) {
            nextActiveTape = touchFocusedTape;
        } else {
            // On phone, only intentional tap-focus should activate hover/description.
            if (touchFocusedTape && !isTapeInteractable(touchFocusedTape)) {
                touchFocusedTape = null;
            }
            nextActiveTape = null;
        }
    }

    state.activeTape = nextActiveTape;
    state.minDist = currentFrameMinDist;

    const hoverFocusTape = (!state.isLocked && state.zoom > 0.9) ? state.activeTape : null;
    const selectedFocusTape = (state.selectedTape && state.selectedTape.visible) ? state.selectedTape : null;
    const focusTape = selectedFocusTape || hoverFocusTape;
    const hasFocusCandidate = !!focusTape && focusTape.visible;
    const focusOrder = hasFocusCandidate ? focusTape.userData.filteredOrder : -1;

    // Lightweight hover highlight (no extra render pass): focused tape bright, others dim.
    tapes.forEach((tape) => {
        const highlighted = hasFocusCandidate && tape === focusTape;
        const indexDistance = hasFocusCandidate && tape.userData.filteredOrder >= 0 && focusOrder >= 0
            ? Math.abs(tape.userData.filteredOrder - focusOrder)
            : 0;
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
                        mat.color.lerp(TAPE_TMP_COLOR, highlightColorLerpFactor);
                    } else {
                        TAPE_TMP_COLOR.copy(mat.userData.baseColor).multiplyScalar(dimScalar);
                        mat.color.lerp(TAPE_TMP_COLOR, highlightColorLerpFactor);
                    }
                } else {
                    mat.color.lerp(mat.userData.baseColor, highlightColorLerpFactor);
                }
            }

            if (typeof mat.emissiveIntensity === 'number') {
                const baseEmissive = (typeof mat.userData.baseEmissiveIntensity === 'number') ? mat.userData.baseEmissiveIntensity : 0;
                const targetEmissive = hasFocusCandidate
                    ? (baseEmissive + (highlighted ? TAPE_HIGHLIGHT.emissiveBoost : 0))
                    : baseEmissive;
                mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, targetEmissive, highlightEmissiveLerpFactor);
            }
        });
    });

    const canTiltActiveTape = !state.isLocked && state.zoom > 0.9 && !hoverSuppressed;

    tapes.forEach((tape) => {
        if (!tape.visible) return;
        if (tape.userData.filteredOrder < 0) return;

        // Keep clicked/selected tape animation untouched.
        if (state.selectedTape === tape) return;

        const isHoveredTape = canTiltActiveTape && tape === state.activeTape;
        const targetRotX = isHoveredTape ? -mouse.y * 0.15 : 0;
        const targetRotY = isHoveredTape ? mouse.x * 0.20 : 0;

        tape.rotation.x = THREE.MathUtils.lerp(tape.rotation.x, targetRotX, tapeRotationLerpFactor);
        tape.rotation.y = THREE.MathUtils.lerp(tape.rotation.y, targetRotY, tapeRotationLerpFactor);
    });
    
    
    // Hover Animation Triggers
    if (!state.isLocked && state.activeTape !== state.previousTape) {
        if (state.previousTape?.userData.action1) {
            const hov = state.previousTape.userData.action1;
            hov.paused = false; hov.timeScale = -1; hov.play();
            if(hoverUI) hoverUI.classList.remove('visible');
            clearTapePreviewUi();
        }
        if (state.activeTape?.userData.action1) {
            playTapeUiSfx();
            const hov = state.activeTape.userData.action1;
            hov.paused = false; hov.timeScale = 1; hov.play();
            const data = state.activeTape.userData.projectInfo;
            if (data && hoverUI) {
                if (hoverCategoryEl) hoverCategoryEl.innerText = data.category ? data.category.toUpperCase() : 'SYSTEM FILE';
                if (hoverTitleEl) hoverTitleEl.innerText = data.title ? data.title.toUpperCase() : 'UNKNOWN_DATA';
                if (hoverDescEl) hoverDescEl.innerText = data.shortDesc ? data.shortDesc : '';
                hoverUI.classList.add('visible');
                showTapePreviewForProject(data);
            }
        }
        state.previousTape = state.activeTape;
    }

    

    // 3. CAMERA
    const targetX = THREE.MathUtils.lerp(POS_START.x, POS_END.x, state.zoom);
    const targetY = THREE.MathUtils.lerp(POS_START.y, POS_END.y, state.zoom);
    const targetZ = THREE.MathUtils.lerp(POS_START.z, POS_END.z, state.zoom);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, cameraLerpFactor);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, cameraLerpFactor);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, cameraLerpFactor);
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
                sequenceTimelineFrame = THREE.MathUtils.lerp(sequenceTimelineFrame, transitionTarget, sequenceTransitionLerpFactor);
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

    renderer.render(scene, camera);
}

animate();

const getAudioAssetUrl = (path) => (
    typeof window.getVersionedAssetUrl === 'function'
        ? window.getVersionedAssetUrl(path)
        : path
);

const buttonClickSfx = new Audio(getAudioAssetUrl('sounds/button_channel.wav'));
buttonClickSfx.preload = 'auto';
buttonClickSfx.volume = 0.5;

const hoverSfx = new Audio(getAudioAssetUrl('sounds/hover.wav'));
hoverSfx.preload = 'auto';
hoverSfx.volume = 0.28;

const navHoverSfx = new Audio(getAudioAssetUrl('sounds/pencil.wav'));
navHoverSfx.preload = 'auto';
navHoverSfx.volume = 0.28;

const tapeScrollHoverSfx = new Audio(getAudioAssetUrl('sounds/hover.wav'));
tapeScrollHoverSfx.preload = 'auto';
tapeScrollHoverSfx.volume = 0.48;

const projectSelectSfx = new Audio(getAudioAssetUrl('sounds/click.wav'));
projectSelectSfx.preload = 'auto';
projectSelectSfx.volume = 0.5;

const tapeInSfx = new Audio(getAudioAssetUrl('sounds/tape_in.wav'));
tapeInSfx.preload = 'auto';
tapeInSfx.volume = 0.5;

const cameraSwoosh = new Audio(getAudioAssetUrl('sounds/swoosh.wav'));
cameraSwoosh.preload = 'auto';
cameraSwoosh.volume = 0.55;
swooshSfx = cameraSwoosh;
primeSwooshOnFirstGesture();

if (!DISABLE_PHONE_BUZZ_AUDIO) {
    const staticAmbience = new Audio(getAudioAssetUrl('sounds/static.wav'));
    staticAmbience.preload = 'auto';
    staticAmbience.loop = true;
    staticAmbience.volume = STATIC_BUZZ.baseVolume;
    staticAmbienceSfx = staticAmbience;

    const buzzLayer = new Audio(getAudioAssetUrl('sounds/buzz.wav'));
    buzzLayer.preload = 'auto';
    buzzLayer.loop = true;
    buzzLayer.volume = 0;
    buzzLayer.playbackRate = STATIC_BUZZ.layerBaseRate;
    buzzLayerSfx = buzzLayer;

    bootstrapStaticAmbienceAutoplay();
}

function tryPlaySound(audioObj) {
    audioObj.currentTime = 0;
    return audioObj.play();
}

function playSound(audioObj) {
    tryPlaySound(audioObj).catch(() => {});
}

let lastTapeUiSfxAt = 0;
const TAPE_UI_SFX_COOLDOWN_MS = 90;
function playTapeUiSfx() {
    const now = performance.now();
    if ((now - lastTapeUiSfxAt) < TAPE_UI_SFX_COOLDOWN_MS) return;
    lastTapeUiSfxAt = now;
    playSound(tapeScrollHoverSfx);
}

if (!window.__buttonClickSoundBound) {
    window.__buttonClickSoundBound = true;
    document.addEventListener('click', (event) => {
        const target = event.target instanceof Element
            ? event.target.closest('button, .tv-hotspot')
            : null;
        if (!target) return;
        playSound(buttonClickSfx);
    });
}

const navHoverSoundSelector = '#nav-home, #nav-about, #nav-projects, #nav-contact, #nav-logo';
const hoverSoundSelector = 'button, .tv-hotspot, #hotspot-email, #hotspot-linkedin';
if (!window.__hoverSoundBound && !isCoarsePointerDevice) {
    window.__hoverSoundBound = true;
    document.addEventListener('pointerover', (event) => {
        const targetEl = event.target instanceof Element ? event.target : null;
        if (!targetEl) return;

        if (!window.__navHoverSoundBound) {
            const currentNavHoverTarget = targetEl.closest(navHoverSoundSelector);
            if (currentNavHoverTarget) {
                const previousNavHoverTarget = event.relatedTarget instanceof Element
                    ? event.relatedTarget.closest(navHoverSoundSelector)
                    : null;

                if (currentNavHoverTarget !== previousNavHoverTarget) {
                    playSound(navHoverSfx);
                }
                return;
            }
        }

        const currentHoverTarget = targetEl.closest(hoverSoundSelector);
        if (!currentHoverTarget) return;

        const previousHoverTarget = event.relatedTarget instanceof Element
            ? event.relatedTarget.closest(hoverSoundSelector)
            : null;

        if (currentHoverTarget === previousHoverTarget) return;
        playSound(hoverSfx);
    });
}