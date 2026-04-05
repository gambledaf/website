document.addEventListener("DOMContentLoaded", () => {
    const lightbox = document.getElementById("lightbox");
    const lightboxImg = document.getElementById("lightbox-img");
    const btnClose = document.getElementById("close-lightbox");
    const zoomableImages = document.querySelectorAll(".zoomable");

    const galleryModule = document.querySelector(".scroll-gallery-module");
    const galleryStrip = document.querySelector(".gallery-strip");
    const galleryPrevBtn = document.querySelector(".gallery-nav.prev");
    const galleryNextBtn = document.querySelector(".gallery-nav.next");

    // =========================
    // FORCE GALLERY START POSITION
    // =========================
    if (galleryStrip) {
        if ("scrollRestoration" in history) {
            history.scrollRestoration = "manual";
        }

        window.addEventListener("load", () => {
            galleryStrip.scrollLeft = 0;
        });
    }

    // =========================
    // LIGHTBOX
    // =========================
    if (zoomableImages.length) {
        zoomableImages.forEach(img => {
            img.addEventListener("click", (e) => {
                const imgNode =
                    e.currentTarget.tagName === "IMG"
                        ? e.currentTarget
                        : e.currentTarget.querySelector("img");

                if (imgNode && lightboxImg && lightbox) {
                    lightboxImg.src = imgNode.dataset.full || imgNode.src;
                    lightbox.style.display = "flex";
                }
            });
        });
    }

    if (btnClose && lightbox) {
        btnClose.addEventListener("click", () => {
            lightbox.style.display = "none";
        });
    }

    if (lightbox) {
        lightbox.addEventListener("click", (e) => {
            if (e.target === lightbox) {
                lightbox.style.display = "none";
            }
        });
    }

    // =========================
    // GALLERY BUTTON NAVIGATION
    // =========================
    if (galleryModule && galleryStrip && galleryPrevBtn && galleryNextBtn) {
        const getGalleryStep = () => {
            const firstItem = galleryStrip.querySelector(".gallery-item");
            if (!firstItem) return galleryStrip.clientWidth;

            const styles = window.getComputedStyle(galleryStrip);
            const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;

            return firstItem.getBoundingClientRect().width + gap;
        };

        const updateGalleryButtons = () => {
            const maxScroll = Math.max(0, galleryStrip.scrollWidth - galleryStrip.clientWidth);
            const atStart = galleryStrip.scrollLeft <= 2;
            const atEnd = galleryStrip.scrollLeft >= maxScroll - 2;

            galleryPrevBtn.disabled = atStart;
            galleryNextBtn.disabled = atEnd;
        };

        const scrollGalleryByStep = (direction) => {
            galleryStrip.scrollBy({
                left: getGalleryStep() * direction,
                behavior: "smooth"
            });
        };

        galleryPrevBtn.addEventListener("click", () => scrollGalleryByStep(-1));
        galleryNextBtn.addEventListener("click", () => scrollGalleryByStep(1));

        galleryStrip.addEventListener("scroll", updateGalleryButtons);
        window.addEventListener("resize", updateGalleryButtons);
        updateGalleryButtons();
    }
});