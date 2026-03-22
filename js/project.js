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

