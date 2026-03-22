document.addEventListener("DOMContentLoaded", () => {
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const btnClose = document.getElementById('close-lightbox');
    const zoomableImages = document.querySelectorAll('.zoomable');

    // When an image is clicked, put its source into the lightbox and show it
    zoomableImages.forEach(img => {
        img.addEventListener('click', (e) => {
            lightboxImg.src = e.target.src; 
            lightbox.style.display = 'flex';
        });
    });

    // Close logic
    btnClose.addEventListener('click', () => lightbox.style.display = 'none');
    lightbox.addEventListener('click', (e) => {
        if(e.target === lightbox) lightbox.style.display = 'none';
    });
});

// --- NAVBAR SMART SCROLL LOGIC ---
let lastScrollY = window.scrollY;

window.addEventListener('scroll', () => {
    // Grab the navbar that navbar.js injected
    const navbar = document.querySelector('.retro-header');
    
    if (navbar) {
        // Ensure it has a smooth sliding animation
        navbar.style.transition = 'transform 0.3s ease';
        
        if (window.scrollY > lastScrollY && window.scrollY > 50) {
            // SCROLLING DOWN: Slide the navbar up out of view
            navbar.style.transform = 'translateY(-100%)';
        } else {
            // SCROLLING UP: Bring the navbar back
            navbar.style.transform = 'translateY(0)';
        }
    }
    
    lastScrollY = window.scrollY;
});