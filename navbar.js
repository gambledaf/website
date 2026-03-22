// --- 1. DETERMINE CURRENT LOCATION ---
const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname.endsWith('/');
const inSubfolder = window.location.pathname.includes('/filepage/');

// If we are in the subfolder, we need to go UP one level ("../") to find images and the index.
const basePath = inSubfolder ? '../' : '';

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

function syncNavbarLoadingVisibility() {
    if (!navbarEl || !logoEl) return;

    const loadingVisible = !!loadingScreen && getComputedStyle(loadingScreen).display !== 'none' && getComputedStyle(loadingScreen).opacity !== '0';

    navbarEl.classList.toggle('nav-is-hidden', loadingVisible);
    logoEl.classList.toggle('nav-is-hidden', loadingVisible);
}

syncNavbarLoadingVisibility();

if (loadingScreen) {
    const loadingObserver = new MutationObserver(syncNavbarLoadingVisibility);
    loadingObserver.observe(loadingScreen, { attributes: true, attributeFilter: ['style', 'class'] });
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

// Shared scroll hide/show behavior for both navbar links and standalone logo
let lastScrollY = window.scrollY;
window.addEventListener('scroll', () => {
    const navbar = document.querySelector('.retro-header');
    const logo = document.querySelector('.retro-logo');
    const shouldHide = window.scrollY > lastScrollY && window.scrollY > 50;

    if (navbar) {
        navbar.style.transform = shouldHide ? 'translateY(-100%)' : 'translateY(0)';
    }

    if (logo) {
        logo.style.transform = shouldHide ? 'translateY(-100%)' : 'translateY(0)';
    }

    lastScrollY = window.scrollY;
});