// --- 1. DETERMINE CURRENT LOCATION ---
const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
const inSubfolder = window.location.pathname.includes('/filepage/');

// If we are in the subfolder, we need to go UP one level ("../") to find images and the index.
const basePath = inSubfolder ? '../' : '';

// Basic client-side content protection: disable right-click and drag-save interactions.
document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
});

document.addEventListener('dragstart', (e) => {
    const target = e.target;
    if (target instanceof HTMLImageElement || target instanceof HTMLVideoElement || target instanceof HTMLAnchorElement) {
        e.preventDefault();
    }
});

// Keep the viewport scale fixed so browser zoom shortcuts do not desync DOM and canvas visuals.
window.addEventListener('keydown', (e) => {
    const isZoomShortcut = (e.ctrlKey || e.metaKey) && (
        e.key === '+' ||
        e.key === '=' ||
        e.key === '-' ||
        e.key === '_' ||
        e.key === '0' ||
        e.code === 'NumpadAdd' ||
        e.code === 'NumpadSubtract' ||
        e.code === 'Numpad0'
    );

    if (isZoomShortcut) {
        e.preventDefault();
    }
});

window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
        e.preventDefault();
    }
}, { passive: false });

// --- 2. THE NEW RETRO NAVBAR HTML ---
const navHTML = `
  <div class="crt-overlay"></div>

    <div class="retro-logo" id="nav-logo" style="cursor: pointer;">
            <img src="${basePath}images/logo.svg" alt="My Logo" class="retro-logo-image">
    </div>

  <header class="retro-header">
      <nav class="retro-nav-links">
          <a href="#" id="nav-home">SYS.HOME</a>
          <a href="#" id="nav-about">USR.ABOUT</a>
          <a href="#" id="nav-projects">DIR.ARCHIVE</a>
          <a href="#" id="nav-contact">NET.COMM</a>
      </nav>
  </header>
`;

document.body.insertAdjacentHTML('afterbegin', navHTML);

// Browser back/forward can restore a page with old inline opacity from fade-out transitions.
// Force visible state whenever the page is shown again (including bfcache restores).
function resetBodyVisibility() {
    document.body.style.opacity = '1';
}

resetBodyVisibility();
window.addEventListener('pageshow', resetBodyVisibility);

// Keep navbar hidden while loading screen is active.
const loadingScreen = document.getElementById('loading-screen');
const navbarEl = document.querySelector('.retro-header');
const logoEl = document.querySelector('.retro-logo');

const navVisibilityState = {
    loadingHidden: false,
    scrollHidden: false,
    hoverReveal: false
};

function applyNavbarVisibility() {
    if (!navbarEl || !logoEl) return;

    const shouldHide = navVisibilityState.loadingHidden || (navVisibilityState.scrollHidden && !navVisibilityState.hoverReveal);
    navbarEl.classList.toggle('nav-is-hidden', shouldHide);
    logoEl.classList.toggle('nav-is-hidden', shouldHide);
}

function syncNavbarLoadingVisibility() {
    if (!navbarEl || !logoEl) return;

    const loadingVisible = !!loadingScreen && getComputedStyle(loadingScreen).display !== 'none' && getComputedStyle(loadingScreen).opacity !== '0';

    navVisibilityState.loadingHidden = loadingVisible;
    applyNavbarVisibility();
}

syncNavbarLoadingVisibility();

if (loadingScreen) {
    const loadingObserver = new MutationObserver(syncNavbarLoadingVisibility);
    loadingObserver.observe(loadingScreen, { attributes: true, attributeFilter: ['style', 'class'] });
}

// On project pages: hide navbar on scroll down, reveal when scrolling up or when mouse reaches top edge.
const projectGridEl = document.querySelector('.project-grid');
if ((inSubfolder || projectGridEl) && navbarEl && logoEl) {
    const getCurrentScroll = () => {
        const windowScroll = window.scrollY || document.documentElement.scrollTop || 0;
        const gridScroll = projectGridEl ? projectGridEl.scrollTop : 0;
        return Math.max(windowScroll, gridScroll);
    };

    let lastScroll = getCurrentScroll();
    const deltaThreshold = 4;
    let scrollAccumulator = 0;
    let lastDirection = 0;
    const revealEnterY = 18;
    const revealExitY = 84;
    let hoverHideTimer = null;

    const setHoverReveal = (value) => {
        if (navVisibilityState.hoverReveal === value) return;
        navVisibilityState.hoverReveal = value;
        applyNavbarVisibility();
    };

    const handleProjectScroll = () => {
        const currentScroll = getCurrentScroll();
        const delta = currentScroll - lastScroll;

        if (currentScroll <= 10) {
            navVisibilityState.scrollHidden = false;
            scrollAccumulator = 0;
            lastDirection = 0;
        } else if (delta !== 0) {
            const direction = delta > 0 ? 1 : -1;

            if (direction !== lastDirection) {
                scrollAccumulator = 0;
                lastDirection = direction;
            }

            scrollAccumulator += Math.abs(delta);

            if (scrollAccumulator >= deltaThreshold) {
                navVisibilityState.scrollHidden = direction > 0;
                scrollAccumulator = 0;
            }
        }

        lastScroll = currentScroll;
        applyNavbarVisibility();
    };

    window.addEventListener('scroll', handleProjectScroll, { passive: true });

    if (projectGridEl) {
        projectGridEl.addEventListener('scroll', handleProjectScroll, { passive: true });
    }

    document.addEventListener('mousemove', (e) => {
        const targetEl = e.target instanceof Element ? e.target : null;
        const overNavbar = !!targetEl && (!!targetEl.closest('.retro-header') || !!targetEl.closest('.retro-logo'));

        if (overNavbar || e.clientY <= revealEnterY) {
            if (hoverHideTimer) {
                clearTimeout(hoverHideTimer);
                hoverHideTimer = null;
            }
            setHoverReveal(true);
            return;
        }

        if (navVisibilityState.hoverReveal && e.clientY >= revealExitY) {
            if (hoverHideTimer) clearTimeout(hoverHideTimer);
            hoverHideTimer = setTimeout(() => {
                setHoverReveal(false);
                hoverHideTimer = null;
            }, 120);
        }
    });

    navbarEl.addEventListener('mouseenter', () => {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
        setHoverReveal(true);
    });

    navbarEl.addEventListener('mouseleave', () => {
        if (hoverHideTimer) clearTimeout(hoverHideTimer);
        hoverHideTimer = setTimeout(() => {
            setHoverReveal(false);
            hoverHideTimer = null;
        }, 140);
    });

    logoEl.addEventListener('mouseenter', () => {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
        setHoverReveal(true);
    });

    logoEl.addEventListener('mouseleave', () => {
        if (hoverHideTimer) clearTimeout(hoverHideTimer);
        hoverHideTimer = setTimeout(() => {
            setHoverReveal(false);
            hoverHideTimer = null;
        }, 140);
    });

    document.addEventListener('mouseleave', () => {
        if (hoverHideTimer) clearTimeout(hoverHideTimer);
        setHoverReveal(false);
    });

    // Ensure initial state is correct after navigation/restore.
    handleProjectScroll();
}

// --- 3. THE SMART CLICK LOGIC ---
function handleNavClick(e, action) {
    e.preventDefault(); 
    
    if (isMainPage) {
        // We are in the 3D room: Just move the camera!
        if (typeof window.handleSystemAction === 'function') {
            window.handleSystemAction(action);
        } else {
            console.warn("handleSystemAction not found. Make sure it is attached to the window object in script.js");
        }
    } else {
        // We are in a project subfolder: Navigate back to the 3D room and trigger the action
        sessionStorage.setItem('skipBootLoader', '1');
        window.location.href = `${basePath}index.html?action=${action}`;
    }
}

// Attach the smart click logic to our new retro buttons
document.getElementById('nav-home').addEventListener('click', (e) => handleNavClick(e, "home"));
document.getElementById('nav-about').addEventListener('click', (e) => handleNavClick(e, "about"));
document.getElementById('nav-projects').addEventListener('click', (e) => handleNavClick(e, "projects"));
document.getElementById('nav-contact').addEventListener('click', (e) => handleNavClick(e, "contact"));

// Make clicking the logo take you home, just like before
document.getElementById('nav-logo').addEventListener('click', (e) => handleNavClick(e, "home"));

