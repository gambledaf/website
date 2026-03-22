import * as THREE from "https://esm.sh/three@0.129.0";
import { GLTFLoader } from "https://esm.sh/three@0.129.0/examples/jsm/loaders/GLTFLoader.js";
import { RenderPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/RenderPass.js";
import { EffectComposer } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/EffectComposer.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutlinePass } from "https://esm.sh/three@0.129.0/examples/jsm/postprocessing/OutlinePass.js";
import { setupSceneLights } from './js/lights.js';
import { projectData } from './js/files.js';
import { crtShaderMaterial, typeSentence, renderCRT, setScreenTextInstant } from './js/crt.js';

// Back/forward cache can restore an in-between transition frame (e.g. tape flip + LOADING PROJECT).
// Force a clean re-init when returning via browser history.
window.addEventListener('pageshow', (event) => {
    const navEntry = performance.getEntriesByType('navigation')[0];
    const cameFromHistory = event.persisted || (navEntry && navEntry.type === 'back_forward');

    if (cameFromHistory) {
        window.location.reload();
    }
});

// --- 1. SHARED HELPERS & STATE ---
function getVisibleConfig() {
    let base = Math.floor(window.innerWidth / 240);
    let count = (base % 2 === 0) ? base + 1 : base;
    count = Math.max(5, Math.min(count, 9));
    return { count, radius: (count - 1) / 2 };
}

// ✅ Cache config — recomputed only on resize, not every frame
let cachedConfig = getVisibleConfig();
const tapes = [];

const numTapes = projectData.length;
const tapeSpacing = 0.55;
// Start at the first visible window (e.g. 0..8 when 9 tapes are visible), not mid-list.
const initialCenter = numTapes > 0
    ? Math.min(cachedConfig.radius, (numTapes - 1) / 2)
    : 0;

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
    hoveredInteractable: null
};

const POS_START = { x: 0, y: 0.6, z: -1.5 };
const POS_END   = { x: 0, y: 0.4, z: 5 };

let typingInterval = null;
let fullGoalText = "";
let currentText = "";
let charIndex = 0;

// --- 3. GLOBAL SCENE ---

const scene = new THREE.Scene();
// scene.background = new THREE.Color(0x000000);
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
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const hdrRenderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat
});

const renderPass = new RenderPass(scene, camera);
const composer = new EffectComposer(renderer, hdrRenderTarget);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
    // ✅ Bloom at 75% resolution — visually identical, meaningfully cheaper
    new THREE.Vector2(window.innerWidth * 0.75, window.innerHeight * 0.75),
    3,
    0.5,
    1.2
);
composer.addPass(bloomPass);
// --- NEW: OPTIMIZED OUTLINE PASS ---
// Running at 50% resolution to save performance
const outlinePass = new OutlinePass(
    new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
    scene,
    camera
);

// Performance tweak
outlinePass.downSampleRatio = 2; 

// Visual styling (Retro green to match your CRT)
outlinePass.edgeStrength = 4.0;
outlinePass.edgeGlow = 1.0;
outlinePass.edgeThickness = 2.0;
outlinePass.visibleEdgeColor.set(0x00ff44); 
outlinePass.hiddenEdgeColor.set(0x002200);

composer.addPass(outlinePass);
setupSceneLights(scene);

// --- 4. SCENE DATA ---
const mouse = new THREE.Vector2(-100, -100);
const raycaster = new THREE.Raycaster();
const clock = new THREE.Clock();

// ✅ Reusable vector — avoids allocating new THREE.Vector3() every frame
const tempVec = new THREE.Vector3();

// ✅ Dedicated interactables list — raycaster only hits what matters
const interactables = [];

let tvModel;
let slideModel = null;
let slideMixer = null;
let slideAction = null;
const blackMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });


// --- 5. LOAD MODELS & LOADING SCREEN ---
const bootManager = new THREE.LoadingManager();
const tapeManager = new THREE.LoadingManager(); // Separate manager for tapes
const loadingScreen = document.getElementById("loading-screen");
const loadingText = document.getElementById("loading-text");

const startupParams = new URLSearchParams(window.location.search);
const shouldQuickResume =
    sessionStorage.getItem('skipBootLoader') === '1' ||
    localStorage.getItem('returnTapeIndex') !== null ||
    startupParams.has('action');

let bootComplete = false;
let tapesComplete = false;
let finalStateHandled = false;

/// --- SMART HACKER LOADING ENGINE ---
const progressBarFill = document.getElementById("progress-bar");
const loadingTextEl = document.getElementById("loading-text");

let targetProgress = 0;
let displayedProgress = 0;
let bootFinished = false; // Tracks the REAL download status

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

const loadingPhrases = [
    "ESTABLISHING SECURE CONNECTION...",
    "BYPASSING MAINFRAME...",
    "DECRYPTING ARCHIVES...",
    "ASSEMBLING SCENE DATA...",
    "INITIALIZING CRT OVERRIDE...",
    "SYSTEM READY."
];

// 1. The REAL download progress sets the target
bootManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    targetProgress = (itemsLoaded / itemsTotal) * 100;
};

// 2. The REAL download finishes
bootManager.onLoad = () => {
    targetProgress = 100;
    bootFinished = true; // Signal the engine that it's safe to exit
    bootComplete = true;
    state.bootComplete = true;

    // Pre-compile the 3D room in the background
    camera.position.set(POS_END.x, POS_END.y, POS_END.z);
    camera.lookAt(0, 0.8, -10);
    composer.render();
    camera.position.set(POS_START.x, POS_START.y, POS_START.z);
    camera.lookAt(0, 0.8, -10);
    composer.render();
    setTimeout(() => renderer.compile(scene, camera), 100);

    if (shouldQuickResume && loadingScreen) {
        clearInterval(progressInterval);
        sessionStorage.removeItem('skipBootLoader');
        loadingScreen.style.opacity = "0";

        setTimeout(() => {
            loadingScreen.style.display = "none";
            document.body.style.opacity = "1";

            if (!tapesComplete) {
                setScreenTextInstant("SYNCING ARCHIVES...\nPLEASE WAIT");
            } else {
                runFinalLoadStateOnce();
            }
        }, 120);
    }
};

// 3. The Visual Engine (Runs every 30ms)
const progressInterval = setInterval(() => {
    
    // Animate the bar catching up to the real download
    if (displayedProgress < targetProgress) {
        
        if (bootFinished) {
            // If the files loaded instantly, sprint to 100% to get out of the user's way
            displayedProgress += 15; 
        } else {
            // Otherwise, chase the download speed smoothly with a tiny hacker "jitter"
            displayedProgress += (targetProgress - displayedProgress) * 0.15;
            displayedProgress += Math.random() * 2;
        }

        if (displayedProgress > targetProgress) displayedProgress = targetProgress;

        // Update DOM
        if (progressBarFill) progressBarFill.style.width = `${displayedProgress}%`;

        let phraseIndex = Math.floor((displayedProgress / 100) * (loadingPhrases.length - 1));
        if (loadingTextEl) {
            loadingTextEl.innerText = `${loadingPhrases[phraseIndex]} [${Math.floor(displayedProgress)}%]`;
        }
    }

    // 4. Trigger the fade ONLY when both the visual bar AND the real download are 100%
    if (displayedProgress >= 100 && bootFinished) {
        clearInterval(progressInterval); // Kill the visual engine

        // Pause for just 200ms (1/5th of a second) so it doesn't look like a glitch
        setTimeout(() => {
            loadingScreen.style.opacity = "0";
            
            setTimeout(() => {
                loadingScreen.style.display = "none";
                document.body.style.opacity = "1";
                
                if (!tapesComplete) {
                    setScreenTextInstant("SYNCING ARCHIVES...\nPLEASE WAIT");
                } else {
                    runFinalLoadStateOnce();
                }
            }, 800); // Wait for the CSS fade transition to end
        }, 200); 
    }
}, 30);

// 2. TAPE SEQUENCE (Background downloading)
tapeManager.onLoad = () => {
    tapesComplete = true;
    state.tapesComplete = true;
    if (bootComplete) {
        runFinalLoadStateOnce();
    }
};

tapeManager.onProgress = (url, itemsLoaded, itemsTotal) => {
    if (bootComplete && !tapesComplete) {
        const progress = Math.floor((itemsLoaded / itemsTotal) * 100);
        setScreenTextInstant(`SYNCING ARCHIVES... ${progress}%\nPLEASE WAIT`);
    }
};

function handleFinalLoadState() {
    // Check for our hidden notes
    const returnIndex = localStorage.getItem('returnTapeIndex');
    
    // Check for navbar actions in the URL
    const urlParams = new URLSearchParams(window.location.search);
    const action = urlParams.get('action');

    if (returnIndex !== null) {
        // --- 1. EJECT & RETURN TRICK ---
        localStorage.removeItem('returnTapeIndex'); 
        
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
        // --- 2. NAVBAR CLICK TRICK (SKIP INTRO) ---
        // Pre-position the camera so the animation starts instantly
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

        // Clean up the URL so it looks professional (removes the ?action=)
        window.history.replaceState({}, document.title, window.location.pathname);

        // Instantly trigger the correct TV text and logic
        handleSystemAction(action);

    } else {
        // --- 3. NORMAL FIRST-TIME LOAD ---
        typeSentence("SYSTEM ONLINE.\n\nSCROLL TO BROWSE ARCHIVE.");
    }
}

const bootLoader = new GLTFLoader(bootManager);
const tapeLoader = new GLTFLoader(tapeManager);
window.handleSystemAction = handleSystemAction;


bootLoader.load("models/slide.glb", gltf => {
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
});

bootLoader.load("models/tv.glb", gltf => {
    tvModel = gltf.scene;
    tvModel.position.set(0, 0, 0);

    tvModel.traverse(c => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true;

            if (c.name === "screen") {
                c.material = crtShaderMaterial;
            } else {
                // ✅ 1. Reference the existing material from the GLB
                const mat = c.material;

                // ✅ 2. Fix the color space for the Diffuse/Albedo map
                if (mat.map) {
                    mat.map.colorSpace = THREE.SRGBColorSpace;
                }

                mat.roughness = 1; // Multiplier for your roughness map
                mat.metalness = 0.0; // Keep at 0 for plastic, 1 for metal parts
                
                // If you want the normal map to be stronger/weaker:
                if (mat.normalMap) {
                    mat.normalScale.set(1, 1); 
                }

                // ✅ 4. Handle Buttons (Interactable logic)
                const name = (c.name || "").toLowerCase();
                if (name.includes("button")) {
                    // Clone so buttons can highlight individually
                    c.material = mat.clone();
                    c.userData.isInteractable = true;
                    c.userData.origEmissive = c.material.emissive.getHex();
                    interactables.push(c);
                }
            }
        }
    });

    scene.add(tvModel);
});

// --- BACKGROUND GLTF LOADER ---
bootLoader.load('models/background.glb', (gltf) => {
    const backdrop = gltf.scene;
    
    
    backdrop.traverse((node) => {
        // Target the specific mesh name from your Blender file
        if (node.isMesh && node.name === "background") {
            
            // 1. Force the material to ignore scene lighting 
            // This ensures your custom gray-to-black gradient is perfectly clear
            node.material.emissiveIntensity = 1.0; 
            
            // 2. Depth Settings: Keep it as the "furthest" layer
            node.material.depthWrite = false;
            node.material.depthTest = true; // Still allow foreground objects to hide it
            
            // 3. Color Accuracy
            if (node.material.map) {
                node.material.map.colorSpace = THREE.SRGBColorSpace;
            }
        }
    });

    // Move it to the back of the "void"
    backdrop.position.set(0, 0, -100);
    backdrop.renderOrder = -100; // Forces it to render first (behind everything)

    scene.add(backdrop);
});
// --- TABLE LOADER ---
bootLoader.load("models/table.glb", gltf => {
    const table = gltf.scene;
    table.name = "table";
    
    // Position it so the top surface is at y: -0.3 
    // (Where your tapes currently sit)
    table.position.set(0, -0.3, -5); 
    table.scale.set(1, 1, 1);

    table.traverse(c => {
        if (c.isMesh) {
            c.castShadow = true;
            c.receiveShadow = true; // Crucial for the green glow to hit the wood/metal
            
            // Give it a slightly reflective "polished" finish
            c.material.roughness = 0.5;
            c.material.metalness = 0;
        }
    });

    scene.add(table);
});
tapeLoader.load("models/tape.glb", gltf => {
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
});

// --- BACKGROUND RETRO GRID ---
// Parameters: size of grid, number of squares, center line color, grid color
const gridSize = 60;
const gridDivisions = 60;
const gridColor = 0xaaaaaa; // Light grey/white to match your reference

const bgGrid = new THREE.GridHelper(gridSize, gridDivisions, gridColor, gridColor);

// By default, GridHelper lays flat on the floor. 
// We rotate it 90 degrees to stand it up like a wall facing the camera.
bgGrid.rotation.x = Math.PI / 2;

// Push it way back behind the TV and the table
bgGrid.position.set(0, 0, -15); 

// Make it look subtle and retro (adjust opacity to taste)
bgGrid.material.transparent = true;
bgGrid.material.opacity = 0.15; 

// If you want your bloom pass to make it glow slightly, keep this line:
bgGrid.material.color.setHex(0xffffff); 

scene.add(bgGrid);

// --- 6. LOGIC & TEXT ---
function toggleTVPower() {
    state.tvOn = !state.tvOn;
    tvModel.traverse(c => {
        if (c.isMesh && c.name === "screen") c.material = state.tvOn ? crtShaderMaterial : blackMaterial;
    });
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

    // ✅ Use cached config
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

    // ✅ Only place we recompute config
    cachedConfig = getVisibleConfig();
    const { radius } = cachedConfig;
    state.targetScroll = THREE.MathUtils.clamp(state.targetScroll, radius, numTapes - 1 - radius);
    outlinePass.resolution.set(window.innerWidth * 0.5, window.innerHeight * 0.5);
});

window.addEventListener('click', () => {

    raycaster.setFromCamera(mouse, camera);
    
    // 1. TEST BUTTONS
    const buttonHits = raycaster.intersectObjects(interactables, false);

    // 2. TEST TAPES
    const visibleTapes = tapes.filter(t => t.visible);
    const tapeHits = raycaster.intersectObjects(visibleTapes, true);
    if (state.zoom > 0.9 && state.activeTape && !state.isLocked) {
        state.isLocked = true;
        state.scrollSpeed = 0.03;
        state.selectedTape = state.activeTape;
        state.targetScroll = state.activeTape.userData.index;

        setTimeout(() => {
            const projectData = state.selectedTape.userData.projectInfo;
            openProjectPage(projectData);
        }, 1500); // Triggers 1.5s after the tape slides in
        
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

    // ✅ Raycast only against interactables, not the entire scene
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(interactables, false);

// Inside your click event listener, after the raycast:
    if (intersects.length > 0) {
        const obj = intersects[0].object;
        const name = obj.name.toLowerCase();

        if (name.includes("button")) {
            // Press animation (Adjust Y/X/Z based on your model's orientation)
            obj.position.y -= 0.02; 
            setTimeout(() => obj.position.y += 0.02, 100);

            // THE MAPPING FIX:
            if (name.includes("01")) handleSystemAction("power");
            if (name.includes("02")) handleSystemAction("home");
            if (name.includes("03")) handleSystemAction("about");    // Should zoom IN
            if (name.includes("04")) handleSystemAction("projects"); // Should zoom OUT
            if (name.includes("05")) handleSystemAction("contact");  // Should zoom IN
        }
    }
});
// --- THE MASTER CONTROLLER ---
function handleSystemAction(action) {
    // 1. GLOBAL EJECT (If a tape is currently playing, spit it out first)
    if (state.isLocked) {
        const hud = document.getElementById('project-hud');
        if (hud) hud.classList.remove('active');
        
        if (state.selectedTape) {
            const flip = state.selectedTape.userData.action2;
            if (flip) {
                flip.paused = false;
                flip.timeScale = -1; // Reverse to slide out
                flip.play();
            }
        }
        state.isLocked = false;
        state.selectedTape = null;
        state.scrollSpeed = 0.1; 
    }

    // 2. ROUTE THE ACTIONS
    switch (action) {
        case "power": // Button_01
            toggleTVPower();
            break;

        case "home": // Button_02
            state.targetZoom = 0; // ZOOM OUT
            if (!state.tvOn) toggleTVPower();
            typeSentence("SYSTEM HOME...\n\nWELCOME TO THE ARCHIVE.");
            break;

        case "about": // Button_03
            state.targetZoom = 0;
            if (!state.tvOn) toggleTVPower();
            typeSentence("ABOUT SYSTEM...\n\nI AM A 3D DEVELOPER\nBUILDING INTERACTIVE WORLDS.");
            break;

        case "projects": // Button_04
            state.targetZoom = 1; // ZOOM OUT
            if (!state.tvOn) toggleTVPower();
            typeSentence("PROJECT ARCHIVE...\n\nSELECT A TAPE BELOW.");
            break;

        case "contact": // Button_05
            state.targetZoom = 0;
            if (!state.tvOn) toggleTVPower();
            typeSentence("CONTACT PROTOCOL...\n\nEMAIL: hello@portfolio.com\nSIGNAL: SECURE");
            break;
    }
}

// Helper for the Zoom-In sequence
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
        sessionStorage.setItem('skipBootLoader', '1');

        // 1. Fade the entire 3D screen to black
        document.body.style.transition = "opacity 0.5s ease";
        document.body.style.opacity = "0";

        // 2. Wait for the fade to finish, then change the page
        setTimeout(() => {
            window.location.href = data.url;
        }, 500); 

    } else {
        console.warn("Missing URL in files.js for project:", data?.title);
        typeSentence("ERROR: FILE CORRUPTED.\n\nNO URL FOUND.");
    }
}

// --- 8. ANIMATE ---
function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    

    // ✅ Smooth zoom lerp
    state.zoom = THREE.MathUtils.lerp(state.zoom, state.targetZoom, 0.06);

    // ✅ Fade bloom with zoom — no hard pop, free perf when zoomed out
   // bloomPass.strength = THREE.MathUtils.lerp(bloomPass.strength, state.zoom < 0.5 ? 1.2 : 0.0, 0.05);

    if (slideMixer) slideMixer.update(delta);

    // 1. SCROLL
    state.currentScroll = THREE.MathUtils.lerp(state.currentScroll, state.targetScroll, state.scrollSpeed);

    const { radius } = cachedConfig; // ✅ cached
    const center = Math.round(state.currentScroll);

    // 2. TAPE LOOP
    let currentFrameActiveTape = null;
    let currentFrameMinDist = 999;

    tapes.forEach((tape, i) => {
        tape.visible = i >= center - radius && i <= center + radius;

        // ✅ Only update mixer if tape is visible
        if (tape.visible && tape.userData.mixer) tape.userData.mixer.update(delta);
        if (!tape.visible) return;

        tape.position.x = (i - state.currentScroll) * tapeSpacing;

        if (state.zoom > 0.9) {
            // ✅ Reuse tempVec — no GC pressure
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
        // It expects an array, so we wrap our tape in brackets
        outlinePass.selectedObjects = [tapeToOutline];
    } else {
        // Clear the outline if nothing is selected/hovered
        outlinePass.selectedObjects = [];
    }

    // 3. HOVER ANIMATION TRIGGERS
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

  // 4. CRT RENDER — ✅ skip when TV is off
    if (state.tvOn) {
        renderCRT(renderer);
    }

    // 5. CAMERA
    const targetX = THREE.MathUtils.lerp(POS_START.x, POS_END.x, state.zoom);
    const targetY = THREE.MathUtils.lerp(POS_START.y, POS_END.y, state.zoom);
    const targetZ = THREE.MathUtils.lerp(POS_START.z, POS_END.z, state.zoom);

    camera.position.x = THREE.MathUtils.lerp(camera.position.x, targetX, 0.04);
    camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetY, 0.04);
    camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.04);
    camera.lookAt(0, 0.8, -10);

    // 6. CURSOR & HIGHLIGHT — ✅ single raycaster call against interactables only
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

animate();