// --- 1. DETERMINE CURRENT LOCATION ---
const isMainPage = window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
const inSubfolder = window.location.pathname.includes('/filepage/');

// If we are in the subfolder, we need to go UP one level ("../") to find images and the index.
const basePath = inSubfolder ? '../' : '';

// --- 2. THE NAVBAR HTML ---
const navHTML = `
  <nav class="navbar">
    <div class="navbar__container">
      
      <a href="${basePath}index.html" id="navbar__logo">
        <img src="${basePath}images/logo.svg" alt="Giorgi Gvazava Logo" class="logo-image">
      </a>
      
      <ul class="navbar__menu">
        <li class="navbar__item"><a href="#" id="nav-home" class="navbar__links">HOME</a></li>
        <li class="navbar__item"><a href="#" id="nav-about" class="navbar__links">ABOUT</a></li>
        <li class="navbar__item"><a href="#" id="nav-projects" class="navbar__links">PROJECTS</a></li>
        <li class="navbar__item"><a href="#" id="nav-contact" class="navbar__links">CONTACT</a></li>
      </ul>

    </div>
  </nav>
`;

document.body.insertAdjacentHTML('afterbegin', navHTML);

// --- 3. THE SMART CLICK LOGIC ---
function handleNavClick(e, action) {
    e.preventDefault(); 
    
    if (isMainPage) {
        if (typeof handleSystemAction === 'function') {
            handleSystemAction(action);
        }
    } else {
        // Path-aware return to index!
        window.location.href = `${basePath}index.html?action=${action}`;
    }
}

document.getElementById('nav-home').addEventListener('click', (e) => handleNavClick(e, "home"));
document.getElementById('nav-about').addEventListener('click', (e) => handleNavClick(e, "about"));
document.getElementById('nav-projects').addEventListener('click', (e) => handleNavClick(e, "projects"));
document.getElementById('nav-contact').addEventListener('click', (e) => handleNavClick(e, "contact"));
document.getElementById('navbar__logo').addEventListener('click', (e) => handleNavClick(e, "home"));