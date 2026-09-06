function initializeProjectPageInteractions() {
    // Rebuild the archive grid as a HUD console before anything else queries the DOM
    buildProjectConsole();

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
    initLightbox();

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

    // =========================
    // SCROLL PROGRESS BAR
    // =========================
    initScrollProgress();

    // =========================
    // ENTRANCE ANIMATIONS
    // =========================
    initEntranceAnimations();

    // =========================
    // GALLERY THUMBNAILS
    // =========================
    initGalleryThumbs();

    // =========================
    // EJECT BUTTON
    // =========================
    initEjectButton();
}

function initScrollProgress() {
    const bar = document.getElementById("scroll-progress");
    if (!bar) return;

    const update = () => {
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
        bar.style.width = pct + "%";
    };

    window.addEventListener("scroll", update, { passive: true });
    update();
}

function initEntranceAnimations() {
    const items = document.querySelectorAll(".animate-in");
    if (!items.length) return;

    // Apply staggered delays based on visual order
    items.forEach((item, i) => {
        const delay = Math.min(i * 0.08, 0.48);
        item.style.transitionDelay = delay + "s";
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.08, rootMargin: "0px 0px -30px 0px" });

    items.forEach(item => observer.observe(item));
}


function initGalleryThumbs() {
    const strip = document.querySelector(".gallery-strip");
    const thumbsContainer = document.getElementById("gallery-thumbs");
    if (!strip || !thumbsContainer) return;

    const galleryItems = strip.querySelectorAll(".gallery-item");

    galleryItems.forEach((item, i) => {
        const img = item.querySelector("img");
        if (!img) return;

        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "gallery-thumb" + (i === 0 ? " active" : "");
        thumb.setAttribute("aria-label", "Jump to image " + (i + 1));

        const thumbImg = document.createElement("img");
        thumbImg.src = img.src;
        thumbImg.alt = "";
        thumb.appendChild(thumbImg);

        thumb.addEventListener("click", () => {
            const targetLeft = item.offsetLeft - strip.offsetLeft;
            strip.scrollTo({ left: targetLeft, behavior: "smooth" });
        });

        thumbsContainer.appendChild(thumb);
    });

    const updateActiveThumbs = () => {
        const thumbBtns = thumbsContainer.querySelectorAll(".gallery-thumb");
        let activeIndex = 0;
        galleryItems.forEach((item, i) => {
            if (item.offsetLeft - strip.offsetLeft <= strip.scrollLeft + 10) {
                activeIndex = i;
            }
        });
        thumbBtns.forEach((t, i) => t.classList.toggle("active", i === activeIndex));
    };

    strip.addEventListener("scroll", updateActiveThumbs, { passive: true });
}

function initEjectButton() {
    const btn = document.getElementById("eject-btn");
    if (!btn) return;

    const tapeIndex = parseInt(btn.dataset.tapeIndex ?? "0", 10);

    btn.addEventListener("click", (e) => {
        e.preventDefault();
        localStorage.setItem("returnTapeIndex", tapeIndex);
        document.body.style.transition = "opacity 0.5s ease";
        document.body.style.opacity = "0";
        setTimeout(() => { window.location.href = btn.href; }, 500);
    });
}


/* ==========================================================
   PROJECT CONSOLE
   Rebuilds the archive grid as a HUD screen:
   left   -> thumbnail index, specs and the active file readout,
             pinned in place while the page scrolls
   right  -> one window, also held still, with the works laid out
             in a strip that travels sideways through it
   Page scroll drives that sideways travel; when the strip runs
   out the window unpins and the page carries on down.
   The static grid stays in the HTML as the no-JS fallback and
   is used here as the data source, so project pages keep the
   same authoring format.
   ========================================================== */

const projectConsole = {
    entries: [],
    index: 0,
    els: null,
    /* How far the strip has to travel, the page scroll position where the
       window pins and that travel starts, and the width of the window itself */
    travel: 0,
    pinStart: 0,
    windowWidth: 0,
    /* The window's size along whichever axis the works travel */
    span: 0,
    /* Scroll held at each end of the run, before the works start moving and
       after they finish, so neither changeover lands hard */
    lead: 0,
    /* Some projects read better as a column than a strip. The mechanism is the
       same either way - page scroll drives the works through a window that stays
       put - only the axis changes. */
    vertical: false,
    /* Placed by hand instead of laid out. Positions are fractions of the canvas
       width, so the composition keeps its proportions at any screen size. */
    free: false,
    canvas: 1.4,
    // How far the works have travelled, kept so the pointer can be read against it
    offset: 0,
    /* Where the pointer is over the window. The works move under it without the
       browser saying anything, so its position has to be kept and re-read. */
    pointer: { inside: false, x: 0, y: 0 },
    /* A work chosen by hand, kept selected while the page travels to it and
       for as long as the reader stays there */
    hold: null,
    frameQueued: false,
    measureQueued: false
};

/* Works that hold a box rather than a picture. What goes in one has no shape of
   its own for the box to take, so the box is set by hand and the corner grip
   drags out both of its sides. */
const isFramed = (entry) => entry.type === "gallery"
    || entry.type === "compare"
    || entry.type === "note"
    || entry.type === "spacer";

/* Furniture. It holds a place on the canvas, but it is not something the reader
   came to look at, so it stays out of the index, the counter and the seeking. */
const isDecor = (entry) => entry.type === "note" || entry.type === "spacer";

function buildProjectConsole() {
    const grid = document.querySelector(".project-grid");
    if (!grid) return;

    const entries = collectConsoleEntries(grid);
    if (!entries.length) return;

    const mode = grid.dataset.layout;
    const free = mode === "free";
    // A hand-placed canvas is taller than the window and travels the same way
    const vertical = free || mode === "scroll";

    projectConsole.free = free;
    projectConsole.vertical = vertical;
    projectConsole.canvas = Number(grid.dataset.canvas) || 1.4;

    /* Each work remembers its number among the works, which is not its place in
       the entries: a note or a spacer sits between them without being one. */
    let counted = 0;
    entries.forEach((entry) => { entry.slot = isDecor(entry) ? 0 : ++counted; });

    const total = counted;
    const totalLabel = padUnit(total);

    const consoleEl = document.createElement("div");
    consoleEl.className = "project-console";
    consoleEl.innerHTML = `
        <div class="console-stage">
            <div class="console-body">
                <aside class="console-panel">
                    <section class="console-block index-block animate-in">
                        <span class="block-label">INDEX</span>
                        <div class="index-head">
                            <span>&gt; ASSETS</span>
                            <span>[ ${totalLabel} ]</span>
                        </div>
                        <div class="thumb-rail"></div>
                    </section>
                    <section class="console-block meta-block animate-in">
                        <span class="block-label">SPECS</span>
                    </section>
                    <section class="console-block desc-block animate-in">
                        <span class="block-label">FILE_DATA</span>
                        <div class="desc-index">[ <span class="desc-pos">01</span> / ${totalLabel} ]</div>
                        <div class="desc-title"></div>
                        <p class="desc-body"></p>
                        <div class="desc-readout">
                            <span class="readout-cell"><i>TYPE</i><b class="ro-type">IMG</b></span>
                            <span class="readout-cell"><i>RES</i><b class="ro-res">----</b></span>
                            <span class="readout-cell sig-cell"><i>SIG</i><b class="sig-bar"><s></s><s></s><s></s><s></s></b></span>
                        </div>
                        <div class="seek-row">
                            <button type="button" class="seek-nav prev" aria-label="Previous work">[ &lt; ]</button>
                            <div class="seek-ticks" aria-hidden="true"></div>
                            <button type="button" class="seek-nav next" aria-label="Next work">[ &gt; ]</button>
                        </div>
                    </section>
                </aside>
                <section class="console-feed">
                    <div class="work-head">
                        <span class="work-name"></span>
                        <span class="work-pos"></span>
                    </div>
                    <div class="work-view">
                        <div class="feed-track">
                            <div class="feed-row"></div>
                            <div class="feed-row"></div>
                        </div>
                        <span class="frame-corner tl"></span>
                        <span class="frame-corner tr"></span>
                        <span class="frame-corner bl"></span>
                        <span class="frame-corner br"></span>
                        <span class="frame-readout">----</span>
                    </div>
                </section>
            </div>
        </div>
    `;

    /* The file header belongs inside the frame, not above it: it names the work
       on screen, so it has to stay on screen with it. */
    const pageHeader = document.querySelector(".window-header");
    const stage = consoleEl.querySelector(".console-stage");
    if (pageHeader) stage.insertBefore(pageHeader, stage.firstElementChild);

    // Reuse the existing meta table instead of duplicating its content
    const metaBlock = consoleEl.querySelector(".meta-block");
    const metaSource = grid.querySelector(".project-meta");
    if (metaSource) {
        metaBlock.appendChild(metaSource);
    } else {
        metaBlock.remove();
    }

    const rail = consoleEl.querySelector(".thumb-rail");
    const ticks = consoleEl.querySelector(".seek-ticks");
    const track = consoleEl.querySelector(".feed-track");

    /* A column has no rows to balance - the works simply follow one another down
       the track, each as wide as the window. */
    if (vertical) track.replaceChildren();
    track.classList.toggle("is-vertical", vertical && !free);
    track.classList.toggle("is-free", free);
    const rows = Array.from(track.children);

    /* Works marked to share a line are collected two at a time into a pair, so a
       run of narrow ones sits side by side instead of each taking a whole line
       to itself. Anything not marked breaks the run and takes its own line. */
    let pair = null;

    // layoutConsoleRows deals them into the two rows once their shapes are known
    const slides = entries.map((entry, i) => {
        const thumb = buildConsoleThumb(entry, i);
        const tick = document.createElement("span");
        // Kept in the row so the lists stay in step with the entries, just unseen
        if (isDecor(entry)) thumb.hidden = tick.hidden = true;
        rail.appendChild(thumb);
        ticks.appendChild(tick);

        const slide = buildConsoleSlide(entry, i);

        if (!vertical) {
            rows[0].appendChild(slide);
            return slide;
        }

        if (free) {
            track.appendChild(slide);
            return slide;
        }

        if (!entry.half) {
            pair = null;
            track.appendChild(slide);
            return slide;
        }

        if (!pair || pair.children.length >= 2) {
            pair = document.createElement("div");
            pair.className = "feed-pair";
            track.appendChild(pair);
        }
        pair.appendChild(slide);
        return slide;
    });

    grid.replaceWith(consoleEl);
    document.body.classList.add("has-console");

    if ("scrollRestoration" in history) {
        history.scrollRestoration = "manual";
    }

    projectConsole.entries = entries;
    projectConsole.els = {
        consoleEl,
        rail,
        panel: consoleEl.querySelector(".console-panel"),
        stage,
        view: consoleEl.querySelector(".work-view"),
        track,
        rows,
        thumbs: Array.from(rail.children),
        ticks: Array.from(ticks.children),
        slides,
        prevBtn: consoleEl.querySelector(".seek-nav.prev"),
        nextBtn: consoleEl.querySelector(".seek-nav.next"),
        descPos: consoleEl.querySelector(".desc-pos"),
        descTitle: consoleEl.querySelector(".desc-title"),
        descBody: consoleEl.querySelector(".desc-body"),
        roType: consoleEl.querySelector(".ro-type"),
        roRes: consoleEl.querySelector(".ro-res"),
        workName: consoleEl.querySelector(".work-name"),
        workPos: consoleEl.querySelector(".work-pos"),
        frameReadout: consoleEl.querySelector(".frame-readout"),
        totalLabel
    };

    projectConsole.els.prevBtn.addEventListener("click", () => goToConsoleEntry(projectConsole.index - 1));
    projectConsole.els.nextBtn.addEventListener("click", () => goToConsoleEntry(projectConsole.index + 1));

    /* Watched on the window rather than on each work: the works travel under the
       pointer, so which one is beneath it is a question for every frame, not
       something an enter event on one of them can answer. */
    projectConsole.els.view.addEventListener("mousemove", (e) => {
        projectConsole.pointer = { inside: true, x: e.clientX, y: e.clientY };
        projectConsole.hold = null;
        updateConsoleSelection();
    });

    projectConsole.els.view.addEventListener("mouseleave", () => {
        projectConsole.pointer.inside = false;
        updateConsoleSelection();
    });

    document.addEventListener("keydown", handleConsoleKeys);
    window.addEventListener("scroll", queueConsoleFrame, { passive: true });
    window.addEventListener("resize", queueConsoleMeasure, { passive: true });

    /* The strip's length only settles as pictures arrive and report their real
       shape, so keep watching both it and the window it has to travel through. */
    if (typeof ResizeObserver === "function") {
        const observer = new ResizeObserver(queueConsoleMeasure);
        observer.observe(track);
        observer.observe(projectConsole.els.view);
    }

    // A note at the top of the order is not what the panel should open on
    setConsoleEntry(Math.max(0, nearestWork(0, 1)), true);
    measureConsoleStrip();
    initConsoleEditing();
}

function buildConsoleThumb(entry, index) {
    const thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "rail-thumb" + (entry.type === "video" || entry.type === "clip" ? " is-video" : "");
    thumb.setAttribute("aria-label", `Jump to ${entry.title}`);

    if (entry.thumb) {
        const img = document.createElement("img");
        img.src = entry.thumb;
        img.alt = "";
        img.loading = "lazy";
        thumb.appendChild(img);
    }

    const num = document.createElement("span");
    num.className = "rail-num";
    num.textContent = padUnit(entry.slot || index + 1);
    thumb.appendChild(num);

    thumb.addEventListener("click", () => goToConsoleEntry(index));

    return thumb;
}

/* One work in the strip. The slide carries the aspect ratio rather than the
   picture, so its width is settled before the file has finished downloading and
   the strip has a length to measure straight away. */
function buildConsoleSlide(entry, index) {
    const isVideo = entry.type === "video";

    const slide = document.createElement("figure");
    slide.className = "work-slide" + (isVideo ? " is-video" : "");

    if (entry.type === "note" || entry.type === "spacer") {
        slide.classList.add(entry.type === "note" ? "is-note" : "is-spacer");

        /* Built out of nodes rather than written as markup: the words are
           whatever was typed into the manager, and they go onto the page as
           words rather than as anything the browser might read as markup. */
        if (entry.type === "note") {
            slide.style.setProperty("--note-scale", entry.textScale || 1);

            const block = document.createElement("div");
            block.className = "note-body";
            block.append(
                Object.assign(document.createElement("b"), { textContent: "> " + entry.title }),
                Object.assign(document.createElement("span"), { textContent: entry.body || "" })
            );
            slide.appendChild(block);
        }

        return slide;
    }

    /* Written into every work, and shown by the column layout only: the strip
       has no room under a picture, and its panel carries the same words. */
    const note = document.createElement("figcaption");
    note.className = "work-note";
    note.append(
        Object.assign(document.createElement("b"), { textContent: "> " + entry.title }),
        Object.assign(document.createElement("span"), { textContent: entry.body || "" })
    );
    if (!entry.body) note.classList.add("is-bare");

    if (entry.type === "clip") {
        slide.classList.add("is-clip");
        if (entry.w && entry.h) slide.style.setProperty("--ar", `${entry.w} / ${entry.h}`);

        const poster = entry.poster ? ` poster="${entry.poster}"` : "";
        slide.innerHTML = `<video class="work-media zoomable" src="${entry.src}"${poster} muted loop playsinline preload="metadata"></video>`;

        /* A clip the page states no size for falls back to the default shape,
           and an upright one shown in a sideways box is black down both sides.
           The file knows what shape it is, so it is asked - the same fallback a
           picture already has for when the page did not say. */
        if (!(entry.w && entry.h)) {
            const clip = slide.querySelector("video");
            clip.addEventListener("loadedmetadata", () => {
                const { videoWidth: w, videoHeight: h } = clip;
                if (!w || !h) return;

                entry.w = w;
                entry.h = h;
                entry.ratio = w / h;
                entry.res = `${w} x ${h}`;
                slide.style.setProperty("--ar", `${w} / ${h}`);
                queueConsoleMeasure();

                // Refresh the readouts too if this is the work in the window
                if (projectConsole.index === index && projectConsole.els) {
                    projectConsole.els.roRes.textContent = entry.res;
                    projectConsole.els.frameReadout.textContent = entry.res;
                }
            }, { once: true });
        }

        slide.appendChild(note);
        return slide;
    }

    if (isVideo) {
        entry.ratio = 16 / 9;
        slide.appendChild(buildEmbedFacade(entry));
        slide.appendChild(note);
        return slide;
    }

    if (entry.type === "compare") {
        slide.classList.add("is-compare");

        /* Both pictures fill the box exactly and sit one on the other, so the
           line has the same thing either side of it wherever it is put. The box
           opens at the first picture's shape, and cropping rather than fitting
           is what keeps the two lined up if the second is a hair different. */
        const [before, after] = entry.frames;
        if (before.w && before.h) slide.style.setProperty("--ar", `${before.w} / ${before.h}`);

        const wrap = document.createElement("div");
        wrap.className = "compare-wrap";

        /* Not zoomable, either of them: a press here is the start of a drag,
           and a lightbox opening under your hand while you drag is not what
           anybody meant by it. */
        const paint = (frame) => {
            const img = document.createElement("img");
            img.src = frame.src;
            if (frame.srcset) img.srcset = frame.srcset;
            img.alt = frame.title;
            img.loading = "lazy";
            img.draggable = false;
            return img;
        };

        wrap.appendChild(paint(before));

        const over = document.createElement("div");
        over.className = "compare-over";
        over.appendChild(paint(after));
        wrap.appendChild(over);

        wrap.insertAdjacentHTML("beforeend",
            `<span class="compare-handle" aria-hidden="true"></span>`
            + `<span class="compare-name left"></span>`
            + `<span class="compare-name right"></span>`);
        wrap.querySelector(".compare-name.left").textContent = before.title;
        wrap.querySelector(".compare-name.right").textContent = after.title;

        slide.appendChild(wrap);
        prepareCompareSlider(slide, wrap);
        slide.appendChild(note);
        return slide;
    }

    if (entry.type === "gallery") {
        slide.classList.add("is-gallery");

        /* The slide keeps the first frame's shape for good. Letting it follow
           each picture would resize the work as you stepped, which on a canvas
           you placed by hand means the whole arrangement moves under you. */
        const first = entry.frames[0];
        if (first.w && first.h) slide.style.setProperty("--ar", `${first.w} / ${first.h}`);

        /* Every frame is laid in a reel across the slide, which slides sideways
           rather than one picture being swapped for another. Each frame takes a
           little under the full width, so the edge of the next one shows past
           it - which is the only thing that says there is a next one at all
           before you have pressed anything. */
        const reel = document.createElement("div");
        reel.className = "gallery-reel";

        const track = document.createElement("div");
        track.className = "gallery-track";
        entry.frames.forEach((frame, n) => {
            const cell = buildGalleryFrame(frame);
            cell.classList.toggle("is-showing", n === 0);
            track.appendChild(cell);
        });

        /* Pressing a frame that is only peeking in brings it round rather than
           opening it - what you can see of it is not enough to look at. */
        track.addEventListener("click", (e) => {
            const cell = e.target.closest ? e.target.closest(".gallery-cell") : null;
            if (!cell) return;
            const wanted = [...track.children].indexOf(cell);
            if (wanted < 0 || wanted === entry.frame) return;
            e.stopPropagation();
            e.preventDefault();
            stepGalleryFrame(index, wanted - entry.frame);
        }, true);

        track.style.transform = `translateX(calc(${CENTRE_OFFSET}))`;

        reel.appendChild(track);
        slide.appendChild(reel);

        const spentNext = entry.frames.length <= 1 ? " is-spent" : "";
        slide.insertAdjacentHTML("beforeend",
            `<button type="button" class="gallery-step prev is-spent" aria-label="Previous frame">[ &lt; ]</button>`
            + `<button type="button" class="gallery-step next${spentNext}" aria-label="Next frame">[ &gt; ]</button>`
            + `<span class="gallery-count">${padUnit(1)} / ${padUnit(entry.frames.length)}</span>`);

        slide.querySelectorAll(".gallery-step").forEach((button) => {
            button.addEventListener("click", (e) => {
                // Or the click would carry on to the picture and open the lightbox
                e.stopPropagation();
                stepGalleryFrame(index, button.classList.contains("next") ? 1 : -1);
            });
        });

        slide.appendChild(note);
        return slide;
    }

    const srcset = entry.srcset ? ` srcset="${entry.srcset}"` : "";
    /* data-full has to travel onto the slide too: the lightbox reads it off
       whatever was clicked, and without it a click lands on the strip's own
       reduced copy, leaving nothing to zoom into. */
    const full = (entry.full && entry.full !== entry.src) ? ` data-full="${entry.full}"` : "";
    slide.innerHTML = `<img class="work-media zoomable" src="${entry.src}"${srcset}${full} alt="${entry.title}" loading="lazy">`;

    /* When the page states the picture's size, the slide is the right shape from
       the first frame and the strip never has to re-measure around it. */
    if (entry.w && entry.h) {
        slide.style.setProperty("--ar", `${entry.w} / ${entry.h}`);
    }

    const img = slide.querySelector("img");
    const showSize = () => {
        if (!img.naturalWidth) return;
        /* Keep the size the page declared: what loads here is the copy made for
           the strip, so measuring it would report the resized width as the
           work's resolution. Only fall back to measuring when nothing was said. */
        if (!entry.w || !entry.h) {
            entry.res = `${img.naturalWidth} x ${img.naturalHeight}`;
        }
        entry.ratio = img.naturalWidth / img.naturalHeight;
        // Trade the placeholder ratio for the real one, which resizes the strip
        slide.style.setProperty("--ar", `${img.naturalWidth} / ${img.naturalHeight}`);
        queueConsoleMeasure();

        // Refresh the readouts too if this is the work currently in the window
        if (projectConsole.index === index && projectConsole.els) {
            projectConsole.els.roRes.textContent = entry.res;
            projectConsole.els.frameReadout.textContent = entry.res;
        }
    };
    img.addEventListener("load", showSize);
    if (img.complete) showSize();

    slide.appendChild(note);
    return slide;
}

/* What the strip is shifted by to bring the frame you are on into the middle,
   before any stepping is counted. Written once so the reel is built and moved
   by the same sum. */
const CENTRE_OFFSET = "(100% - var(--cell)) / 2";

/* The line dragged across a comparison. Where it sits is a share of the work's
   width, handed to the stylesheet, which clips the picture on top to it - so
   nothing is resized and the two stay in register whatever is done to them.
   Pressing anywhere jumps the line there, which is quicker than taking hold of
   it for a glance at one end or the other. */
function prepareCompareSlider(slide, wrap) {
    let dragging = false;

    const putAt = (clientX) => {
        const box = wrap.getBoundingClientRect();
        if (!box.width) return;
        const across = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
        slide.style.setProperty("--split", (across * 100).toFixed(2) + "%");
    };

    wrap.addEventListener("pointerdown", (e) => {
        // While arranging, a press on a work is the start of moving the work
        if (consoleEdit.on) return;

        dragging = true;
        wrap.setPointerCapture(e.pointerId);
        putAt(e.clientX);
        e.preventDefault();
    });

    wrap.addEventListener("pointermove", (e) => {
        if (dragging) putAt(e.clientX);
    });

    const drop = (e) => {
        if (!dragging) return;
        dragging = false;
        try { wrap.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };

    wrap.addEventListener("pointerup", drop);
    wrap.addEventListener("pointercancel", drop);
}

/* One frame of a reel. A picture, a clip that plays where it stands, or an
   embed - each drawn the way its own kind wants, all of them the same size in
   the reel so stepping moves by exactly one every time. */
function buildGalleryFrame(frame) {
    const cell = document.createElement("div");
    cell.className = "gallery-cell";

    if (frame.type === "clip") {
        const poster = frame.poster ? ` poster="${frame.poster}"` : "";
        cell.innerHTML = `<video class="work-media zoomable" src="${frame.src}"${poster}`
            + ` muted loop playsinline preload="metadata"></video>`;
        return cell;
    }

    if (frame.type === "video") {
        cell.appendChild(buildEmbedFacade(frame));
        return cell;
    }

    const set = frame.srcset ? ` srcset="${frame.srcset}"` : "";
    const deep = (frame.full && frame.full !== frame.src) ? ` data-full="${frame.full}"` : "";
    cell.innerHTML = `<img class="work-media zoomable" src="${frame.src}"${set}${deep}`
        + ` alt="${frame.title}" loading="lazy">`;
    return cell;
}

/* Moves a gallery to another of its pictures, in place. The buttons come round
   again at either end; the arrow keys do not, because there the way out of a
   gallery is to keep going, on to the next work. */
function stepGalleryFrame(index, delta) {
    const { entries, els } = projectConsole;
    const entry = entries[index];
    if (!entry || entry.type !== "gallery" || !els) return;

    const count = entry.frames.length;
    entry.frame = Math.min(Math.max(entry.frame + delta, 0), count - 1);
    const frame = entry.frames[entry.frame];

    const slide = els.slides[index];

    /* The reel is moved rather than the frames being rebuilt, so a clip already
       playing keeps playing and nothing is fetched twice. */
    const track = slide.querySelector(".gallery-track");
    track.style.transform =
        `translateX(calc(${CENTRE_OFFSET} - ${entry.frame} * (var(--cell) + var(--reel-gap))))`;
    [...track.children].forEach((cell, n) => cell.classList.toggle("is-showing", n === entry.frame));

    // At either end there is nothing more that way, and the arrow says so
    slide.querySelector(".gallery-step.prev").classList.toggle("is-spent", entry.frame === 0);
    slide.querySelector(".gallery-step.next").classList.toggle("is-spent", entry.frame === count - 1);

    slide.querySelector(".gallery-count").textContent =
        `${padUnit(entry.frame + 1)} / ${padUnit(count)}`;

    /* The readouts describe the picture on show rather than the set holding it,
       so the panel follows the frame. The shape is left alone: the slide keeps
       the one it was built at. */
    entry.src = frame.src;
    entry.full = frame.full;
    entry.res = frame.res;
    if (projectConsole.index === index) setConsoleEntry(index);

    updateConsoleImageSizes();
}

function collectConsoleEntries(grid) {
    const entries = [];
    const clean = (text) => (text || "").replace(/^[\s>]+/, "").trim();

    /* The manager writes a small copy for the index rail, a full-size one for the
       lightbox, and the picture's real shape. Hand-written pages carry none of
       that, so each falls back to the one image the page does have. */
    /* Where a work was placed by hand, if it was. Any of them can be, so this
       is read off whichever element the builder hung the marks on. */
    const readSpot = (el) => ({
        x: el.dataset.x != null ? Number(el.dataset.x) : null,
        y: el.dataset.y != null ? Number(el.dataset.y) : null,
        wFrac: el.dataset.w != null ? Number(el.dataset.w) : null,
        // Only a gallery carries one: it is a frame, and a frame has a height
        hFrac: el.dataset.h != null ? Number(el.dataset.h) : null
    });

    const readImage = (img) => {
        const src = img.getAttribute("src") || "";
        const w = Number(img.getAttribute("width")) || 0;
        const h = Number(img.getAttribute("height")) || 0;
        return {
            type: "image",
            src,
            srcset: img.getAttribute("srcset") || "",
            thumb: img.dataset.thumb || src,
            // Where the lightbox goes for every pixel, rather than the strip's copy
            full: img.dataset.full || src,
            // Narrow enough to share a line with its neighbour, if you said so
            half: img.dataset.half === "1",
            ...readSpot(img),
            w,
            h,
            ratio: (w && h) ? w / h : 0,
            res: (w && h) ? `${w} x ${h}` : ""
        };
    };

    grid.querySelectorAll(".media-module").forEach((module) => {
        const lines = Array.from(module.querySelectorAll(".module-desc p"))
            .map((p) => clean(p.textContent))
            .filter(Boolean);

        const title = lines[0] || "";
        const body = lines.slice(1).join(" ");

        /* A note holds words and a spacer holds nothing at all; both hold a
           place. Neither carries a picture, so neither would be found by any of
           the searches below - they are recognised by what the builder marked
           them as instead. */
        if (module.classList.contains("note-module")) {
            entries.push({
                ...readSpot(module),
                type: "note",
                title: title || "NOTE",
                body,
                /* Set in the manager, on top of whatever the frame's own size
                   works out to - which is what lets a wide note still carry
                   small words, or a small one carry a heading. */
                textScale: Number(module.dataset.ts) || 1,
                // The strip has to give it some shape before it is sized by hand
                ratio: 16 / 9,
                res: ""
            });
            return;
        }

        if (module.classList.contains("spacer-module")) {
            entries.push({
                ...readSpot(module),
                type: "spacer",
                title: "SPACER",
                body: "",
                ratio: 16 / 9,
                res: ""
            });
            return;
        }

        /* Two pictures with a line dragged across them. Asked here for the same
           reason the set is: what a module is has to be settled before what it
           contains is gone looking for. */
        const pair = Array.from(module.querySelectorAll(".compare-frames > *"));
        if (pair.length) {
            const sides = pair.map((img, i) => ({
                ...readImage(img),
                type: "image",
                title: clean(img.alt) || `${title || "COMPARE"}_${i === 0 ? "BEFORE" : "AFTER"}`
            }));

            entries.push({
                ...sides[0],
                ...readSpot(module),
                type: "compare",
                frames: sides,
                title: title || "COMPARE",
                body
            });
            return;
        }

        /* Asked before the searches below, which look anywhere inside the
           module: a set of clips would answer the first of them and a set of
           embeds the second, and either would be read as one plain work with
           the rest of the set thrown away. */
        const frames = Array.from(module.querySelectorAll(".gallery-frames > *"));
        if (frames.length) {
            const shots = frames.map((node, i) => {
                const named = `${title || "GALLERY"}_${padUnit(i + 1)}`;

                /* A frame is whatever kind of thing it is. A clip carries its
                   own shape and a still to show before it plays; an embed has
                   neither, and is given the shape it plays at. */
                if (node.tagName === "VIDEO") {
                    const w = Number(node.getAttribute("width")) || 0;
                    const h = Number(node.getAttribute("height")) || 0;
                    const poster = node.getAttribute("poster") || "";
                    return {
                        type: "clip",
                        src: node.getAttribute("src") || "",
                        poster,
                        thumb: node.dataset.thumb || poster,
                        w, h,
                        ratio: (w && h) ? w / h : 0,
                        res: (w && h) ? `${w} x ${h}` : "",
                        title: clean(node.getAttribute("title")) || named
                    };
                }

                if (node.tagName === "IFRAME") {
                    const src = node.getAttribute("src") || "";
                    return {
                        type: "video",
                        src,
                        thumb: youtubeThumbUrl(src),
                        ratio: 16 / 9,
                        res: "16:9",
                        title: clean(node.getAttribute("title")) || named
                    };
                }

                return {
                    ...readImage(node),
                    type: "image",
                    title: clean(node.alt) || named
                };
            });

            entries.push({
                ...shots[0],
                ...readSpot(module),
                type: "gallery",
                frames: shots,
                frame: 0,
                title: title || "GALLERY",
                body
            });
            return;
        }

        const clip = module.querySelector("video");
        if (clip) {
            const w = Number(clip.getAttribute("width")) || 0;
            const h = Number(clip.getAttribute("height")) || 0;
            const poster = clip.getAttribute("poster") || "";
            entries.push({
                ...readSpot(clip),
                type: "clip",
                src: clip.getAttribute("src") || "",
                poster,
                thumb: clip.dataset.thumb || poster,
                w,
                h,
                ratio: (w && h) ? w / h : 0,
                res: (w && h) ? `${w} x ${h}` : "",
                title: title || "MOTION_CLIP",
                body
            });
            return;
        }

        const iframe = module.querySelector("iframe");
        if (iframe) {
            const src = iframe.getAttribute("src") || "";
            entries.push({
                ...readSpot(iframe),
                type: "video",
                src,
                thumb: youtubeThumbUrl(src),
                title: title || "MOTION_CLIP",
                body,
                // An embed has no shape to measure, and this is the one it plays at
                ratio: 16 / 9,
                res: "16:9"
            });
            return;
        }

        // The older hand-written strip, whose pictures are each their own work
        const galleryImages = module.querySelectorAll(".gallery-item img");
        if (galleryImages.length) {
            galleryImages.forEach((img, i) => {
                entries.push({
                    ...readImage(img),
                    title: `${title || "GALLERY"}_${padUnit(i + 1)}`,
                    body: body || clean(img.alt)
                });
            });
            return;
        }

        const img = module.querySelector("img");
        if (!img) return;

        entries.push({
            ...readImage(img),
            title: title || clean(img.alt) || "UNTITLED",
            body
        });
    });

    return entries;
}

/* Point the readouts at a work. Nothing moves here: where the strip sits is
   decided by page scroll, and this only reports what is in the window.
   trackRail stays false for scroll-driven updates, because nudging the
   thumbnail rail while the reader is already scrolling looks restless. */
function setConsoleEntry(index, trackRail = false) {
    const { entries, els } = projectConsole;
    if (!els || !entries.length) return;

    const nextIndex = Math.min(Math.max(index, 0), entries.length - 1);
    const entry = entries[nextIndex];
    projectConsole.index = nextIndex;

    els.descPos.textContent = padUnit(entry.slot || nextIndex + 1);
    els.descTitle.textContent = entry.title;
    els.descBody.textContent = entry.body || "> NO_DATA";
    els.roType.textContent = (entry.type === "video" || entry.type === "clip") ? "MP4" : "IMG";
    els.roRes.textContent = entry.res || "----";

    // The window keeps one header and one readout, retitled as works pass through
    els.workName.textContent = `> ${entry.title}${consoleFileExt(entry)}`;
    els.workPos.textContent = `[ ${padUnit(entry.slot || nextIndex + 1)} / ${els.totalLabel} ]`;
    els.frameReadout.textContent = entry.res || (entry.type === "video" ? "16:9" : "----");

    els.thumbs.forEach((thumb, i) => thumb.classList.toggle("active", i === nextIndex));
    els.ticks.forEach((tick, i) => tick.classList.toggle("active", i === nextIndex));
    els.slides.forEach((slide, i) => slide.classList.toggle("is-active", i === nextIndex));

    els.prevBtn.disabled = nextIndex === 0;
    els.nextBtn.disabled = nextIndex === entries.length - 1;

    if (trackRail) scrollConsoleThumbIntoView(nextIndex);
}

/* Selecting a work scrolls the page to the point in the travel that brings it
   to the front of the window - the strip has no scroll position of its own */
function goToConsoleEntry(index) {
    const { entries, els } = projectConsole;
    if (!els || !entries.length) return;

    const nextIndex = nearestWork(index, index >= projectConsole.index ? 1 : -1);
    if (nextIndex < 0) return;
    setConsoleEntry(nextIndex, true);

    /* Clamped to what the page can actually reach, so that arriving is always
       possible - the hold below waits for it */
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const target = Math.min(
        projectConsole.pinStart + projectConsole.lead + slideTravelOffset(nextIndex),
        maxScroll
    );

    projectConsole.hold = { index: nextIndex, target, arrived: false };
    window.scrollTo({ top: target, behavior: "smooth" });

    if (typeof playNavClickSound === "function") playNavClickSound();
}

/* The work at that place, or the next one past it in the direction of travel.
   Furniture sits in the running order without being somewhere to arrive at, so
   asking to go to one carries on to whatever is beyond it. */
function nearestWork(index, direction) {
    const { entries } = projectConsole;
    const step = direction < 0 ? -1 : 1;

    for (let i = Math.min(Math.max(index, 0), entries.length - 1);
         i >= 0 && i < entries.length; i += step) {
        if (!isDecor(entries[i])) return i;
    }

    // Nothing that way: hold where we are rather than landing on furniture
    return isDecor(entries[projectConsole.index]) ? -1 : projectConsole.index;
}

/* Where a work begins and how much room it takes, measured along whichever axis
   the works travel. Everything below is written in terms of these two, so the
   column and the strip share one set of rules. */
function slideStart(slide) {
    const { els, vertical, free } = projectConsole;

    // A placed work is positioned against the canvas, so its own top is the answer
    if (free) return parseFloat(slide.style.top) || 0;

    return vertical
        ? slide.offsetTop - els.track.offsetTop
        : slide.offsetLeft - els.track.offsetLeft;
}

function slideSize(slide) {
    return projectConsole.vertical ? slide.offsetHeight : slide.offsetWidth;
}

/* How far the works have to have travelled for one to reach the near edge */
function slideTravelOffset(index) {
    const { els, travel } = projectConsole;
    const slide = els.slides[index];
    if (!slide) return 0;

    return Math.min(Math.max(slideStart(slide), 0), travel);
}

/* The section height is what converts page scroll into sideways travel: one
   screen of window, plus however far the strip overhangs it. Scroll past that
   and the window unpins, which is what lets the page carry on down once the
   works have run out. */
function measureConsoleStrip() {
    const { els } = projectConsole;
    if (!els) return;

    const viewStyle = getComputedStyle(els.view);
    const windowWidth = els.view.clientWidth
        - (parseFloat(viewStyle.paddingLeft) || 0)
        - (parseFloat(viewStyle.paddingRight) || 0);
    const windowHeight = els.view.clientHeight
        - (parseFloat(viewStyle.paddingTop) || 0)
        - (parseFloat(viewStyle.paddingBottom) || 0);

    projectConsole.windowWidth = windowWidth;
    projectConsole.span = projectConsole.vertical ? windowHeight : windowWidth;

    // The column caps each work against this, so none is taller than the window
    els.track.style.setProperty("--window-span", windowHeight + "px");

    layoutConsoleRows();

    /* The track is only the size of the window - the works hang out of its far
       side - so the run is measured from whichever one reaches furthest along.
       The last need not be it: in the strip it may sit in the shorter row. */
    const reach = els.slides.reduce(
        (most, slide) => Math.max(most, slideStart(slide) + slideSize(slide)),
        0
    );

    projectConsole.travel = Math.max(0, reach - projectConsole.span);

    /* A beat of stillness at either end. Without it the works begin moving the
       instant the frame pins and the page resumes the instant they run out, so
       both changeovers arrive with no warning. Holding still for a moment lets
       the pin register before anything starts, and lets the last work be looked
       at before the page moves on. Nothing to travel means nothing to lead in
       to, so a short project keeps the page moving as it always did. */
    projectConsole.lead = Math.min(
        Math.min(340, Math.max(150, window.innerHeight * 0.28)),
        // Never longer than the run it bookends, or a short project spends more
        // scroll waiting than moving
        projectConsole.travel * 0.35
    );

    els.consoleEl.style.height =
        (els.stage.offsetHeight + projectConsole.lead * 2 + projectConsole.travel) + "px";

    // Page scroll position at which the frame reaches its pinned resting place
    const stickyTop = parseFloat(getComputedStyle(els.stage).top) || 0;
    projectConsole.pinStart = els.consoleEl.getBoundingClientRect().top + window.scrollY - stickyTop;

    updateConsoleStrip();
}

/* Fills the two rows and gives each one a height.
 *
 * A work's width is its height times its shape, so a row's length is its height
 * times the shapes it holds, plus its gaps. Wanting both rows the same length L
 * while together filling the height H gives two equations:
 *
 *     hA * SA + gapsA = L = hB * SB + gapsB        hA + hB = H
 *
 * which solve for one L, and from it a height for each row. The rows end up
 * slightly different heights - that is the point. It is what lets every work
 * keep its own shape, the spacing stay even, and the strip still end square.
 */
function layoutConsoleRows() {
    const { els, entries } = projectConsole;

    if (projectConsole.free) {
        layoutConsoleCanvas();
        return;
    }

    if (!els.rows.length) {
        applyColumnWidths();
        updateConsoleImageSizes();
        return;
    }

    const view = els.view;

    const style = getComputedStyle(view);
    const gap = parseFloat(getComputedStyle(els.track).rowGap) || 0;
    const height = view.clientHeight
        - (parseFloat(style.paddingTop) || 0)
        - (parseFloat(style.paddingBottom) || 0)
        - gap;
    if (height <= 0) return;

    /* Each work joins whichever row is shorter so far, measured in shapes rather
       than pixels since the heights are not known yet. Going in order this way is
       what keeps the strip readable left to right. */
    const shapes = [0, 0];
    const wanted = [[], []];
    entries.forEach((entry, i) => {
        const row = shapes[0] <= shapes[1] ? 0 : 1;
        shapes[row] += entry.ratio || 16 / 9;
        wanted[row].push(els.slides[i]);
    });

    wanted.forEach((slides, r) => {
        const row = els.rows[r];
        const unchanged = row.children.length === slides.length
            && slides.every((slide, i) => row.children[i] === slide);
        if (!unchanged) row.replaceChildren(...slides);
    });

    // One row holding everything cannot be balanced against an empty one
    if (!shapes[0] || !shapes[1]) {
        els.rows[0].style.height = height + gap + "px";
        els.rows[1].style.height = "0px";
        updateConsoleImageSizes();
        return;
    }

    const gapsOf = (slides) => Math.max(0, slides.length - 1) * gap;
    const gA = gapsOf(wanted[0]);
    const gB = gapsOf(wanted[1]);
    const length = (height + gA / shapes[0] + gB / shapes[1])
        / (1 / shapes[0] + 1 / shapes[1]);

    /* A wildly lopsided split would leave one row a sliver. Better to give up a
       little squareness at the far end than to show a row nobody can see. */
    let hA = Math.min(Math.max((length - gA) / shapes[0], height * 0.3), height * 0.7);
    els.rows[0].style.height = hA + "px";
    els.rows[1].style.height = (height - hA) + "px";

    updateConsoleImageSizes();
}

/* Puts every work where it was placed. Positions are fractions of the canvas
   width rather than pixels, so the whole arrangement scales as one when the
   window changes size - it keeps its proportions instead of coming apart.
   Anything never placed is dropped into a plain grid to start from. */
/* What a work really takes up on the canvas. A caption is written under the
   picture, outside the box the picture's own shape decides - and that box is all
   offsetHeight reports. Measuring off it alone lays the next work into the words
   of the one above. */
function slideHeight(index) {
    const slide = projectConsole.els.slides[index];
    const box = slide.getBoundingClientRect();
    let bottom = box.bottom;

    for (const child of slide.children) {
        const rect = child.getBoundingClientRect();
        if (rect.bottom > bottom) bottom = rect.bottom;
    }

    return Math.max(slide.offsetHeight, bottom - box.top);
}

function layoutConsoleCanvas() {
    const { els, entries, windowWidth } = projectConsole;
    if (!windowWidth) return;

    ensureCanvasPlacements();

    entries.forEach((entry, i) => {
        const slide = els.slides[i];
        slide.style.left = (entry.x * windowWidth) + "px";
        slide.style.top = (entry.y * windowWidth) + "px";
        slide.style.width = (entry.wFrac * windowWidth) + "px";
        // A frame's height was set by hand; everything else takes its own shape
        if (isFramed(entry) && entry.hFrac != null) {
            slide.style.height = (entry.hFrac * windowWidth) + "px";
        }


    });

    // The canvas has to reach past the lowest work, or the last one is cut off
    const lowest = entries.reduce((deepest, entry, i) => Math.max(
        deepest,
        entry.y * windowWidth + slideHeight(i)
    ), 0);

    els.track.style.height = Math.max(lowest + 24, projectConsole.canvas * windowWidth) + "px";

    /* Words are a share of the canvas too. A caption or a note that kept its
       size while the pictures shrank would grow into whatever sits below it as
       the window narrows, and an arrangement placed by hand would come apart at
       exactly the width nobody was looking at it. */
    els.track.style.setProperty("--canvas-text", (windowWidth * 0.012) + "px");

    updateConsoleImageSizes();
}

/* A project only just switched to hand placement has nothing placed yet. Rather
   than stacking everything at the origin, it starts as a two-column grid, which
   is somewhere sensible to drag away from. */
function ensureCanvasPlacements() {
    const { entries } = projectConsole;
    const columns = 2;
    const margin = 0.04;
    const gap = 0.03;
    const width = (1 - margin * 2 - gap * (columns - 1)) / columns;

    let row = 0;
    let column = 0;
    let rowTop = margin;
    let rowTallest = 0;

    entries.forEach((entry) => {
        if (entry.x != null && entry.y != null && entry.wFrac != null) return;

        entry.x = margin + column * (width + gap);
        entry.y = rowTop;
        entry.wFrac = width;

        rowTallest = Math.max(rowTallest, width / (entry.ratio || 16 / 9));
        column += 1;
        if (column >= columns) {
            column = 0;
            row += 1;
            rowTop += rowTallest + gap;
            rowTallest = 0;
        }
    });

    /* A frame nobody has sized yet takes the shape of the picture it opens on,
       so it starts somewhere sensible rather than as a sliver to be dragged
       open before it shows anything. */
    entries.forEach((entry) => {
        if (isFramed(entry) && entry.hFrac == null) {
            entry.hFrac = entry.wFrac / (entry.ratio || 16 / 9);
        }
    });
}

/* A width dragged out by hand, as a fraction of the window, so it holds at any
   screen size. Anything never resized keeps the width its own picture wants. */
function applyColumnWidths() {
    const { els, entries, windowWidth } = projectConsole;

    entries.forEach((entry, i) => {
        const slide = els.slides[i];
        if (entry.wFrac > 0) slide.style.width = Math.round(entry.wFrac * windowWidth) + "px";
        else slide.style.width = "";
    });
}

/* Once the widths have settled, each picture is told the size it is actually
   being drawn at. Without this the browser assumes the full width of the page
   and fetches a larger copy than the slide can ever show. */
function updateConsoleImageSizes() {
    projectConsole.els.slides.forEach((slide) => {
        const img = slide.firstElementChild;
        if (!img || img.tagName !== "IMG" || !img.srcset) return;

        const width = Math.ceil(slide.offsetWidth);
        if (width) img.sizes = width + "px";
    });
}

function updateConsoleStrip() {
    const { els, travel, pinStart } = projectConsole;
    if (!els) return;

    const offset = Math.min(Math.max(window.scrollY - pinStart - projectConsole.lead, 0), travel);
    projectConsole.offset = offset;
    els.track.style.transform = projectConsole.vertical
        ? `translate3d(0, ${-offset}px, 0)`
        : `translate3d(${-offset}px, 0, 0)`;

    primeConsoleSlides(offset);

    /* A work picked from the index or the seek buttons stays selected while the
       page travels to it, and then for as long as the reader stays put. Without
       that, the rule below would immediately hand the readout to whichever
       neighbour happens to sit closest to the reading line. */
    const hold = projectConsole.hold;
    if (hold) {
        const atTarget = Math.abs(window.scrollY - hold.target) <= 40;
        if (atTarget) hold.arrived = true;

        if (!hold.arrived || atTarget) {
            if (hold.index !== projectConsole.index) setConsoleEntry(hold.index);
            return;
        }

        projectConsole.hold = null;
    }

    updateConsoleSelection();
}

/* What the pointer is actually over, asked fresh rather than remembered. Moving
   the works by transform slides a different one under a still mouse without the
   browser firing anything, so an enter event answers only for where the pointer
   arrived, not for what is beneath it now. */
function slideUnderPointer() {
    const { els, pointer } = projectConsole;
    if (!pointer.inside) return -1;

    const under = document.elementFromPoint(pointer.x, pointer.y);
    const slide = under && under.closest ? under.closest(".work-slide") : null;
    const found = slide ? els.slides.indexOf(slide) : -1;

    // Pointing at a note does not make it the work the panel is describing
    return (found >= 0 && isDecor(projectConsole.entries[found])) ? -1 : found;
}

/* The pointer wins over the reading line: if the reader is pointing at something,
   that is what they mean, wherever the scroll happens to have got to. */
function updateConsoleSelection() {
    const pointed = slideUnderPointer();
    const active = pointed >= 0 ? pointed : activeConsoleSlide(projectConsole.offset);
    if (active !== projectConsole.index) setConsoleEntry(active);
}

/* Whichever work sits under the reading line - a third of the way into the
   window - is the one the panel describes */
function activeConsoleSlide(offset) {
    const { els, span } = projectConsole;
    const line = offset + span * 0.34;

    let bestIndex = 0;
    let bestDistance = Infinity;

    els.slides.forEach((slide, i) => {
        if (isDecor(projectConsole.entries[i])) return;
        const centre = slideStart(slide) + slideSize(slide) / 2;
        const distance = Math.abs(centre - line);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestIndex = i;
        }
    });

    return bestIndex;
}

/* Lazy loading cannot be relied on inside a strip that moves by transform, so
   pictures about to reach the window are asked for outright. Videos are left
   lazy - an embed is far too heavy to pull in on approach. */
function primeConsoleSlides(offset) {
    const { els, span } = projectConsole;
    const from = offset - span;
    const to = offset + span * 2;

    els.slides.forEach((slide) => {
        const media = slide.firstElementChild;
        if (!media) return;

        const left = slideStart(slide);
        const near = left + slideSize(slide) >= from && left <= to;

        if (media.tagName === "VIDEO") {
            /* Only what is on screen plays. Every clip running at once would cost
               far more than it shows, and a paused one off to the side is wasted
               decoding. play() rejects if the browser blocks it; nothing to do. */
            const onScreen = left + slideSize(slide) >= offset && left <= offset + span;
            if (onScreen && media.paused) media.play().catch(() => {});
            else if (!onScreen && !media.paused) media.pause();
            return;
        }

        if (media.tagName !== "IMG" || media.loading !== "lazy" || !near) return;
        media.loading = "eager";
    });
}

function queueConsoleFrame() {
    if (projectConsole.frameQueued) return;
    projectConsole.frameQueued = true;
    requestAnimationFrame(() => {
        projectConsole.frameQueued = false;
        updateConsoleStrip();
    });
}

function queueConsoleMeasure() {
    if (projectConsole.measureQueued) return;
    projectConsole.measureQueued = true;
    requestAnimationFrame(() => {
        projectConsole.measureQueued = false;
        measureConsoleStrip();
    });
}

function scrollConsoleThumbIntoView(index) {
    const { els } = projectConsole;
    if (!els) return;

    const thumb = els.thumbs[index];
    const rail = els.rail;
    if (!thumb || !rail) return;

    // Scroll the rail itself rather than using scrollIntoView, which would
    // also drag the page around it.
    rail.scrollTo({
        top: Math.max(0, thumb.offsetTop - (rail.clientHeight - thumb.clientHeight) / 2),
        left: Math.max(0, thumb.offsetLeft - (rail.clientWidth - thumb.clientWidth) / 2),
        behavior: "smooth"
    });
}

function handleConsoleKeys(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;

    const target = e.target;
    if (target instanceof HTMLElement &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
        return;
    }

    e.preventDefault();

    const step = e.key === "ArrowRight" ? 1 : -1;

    /* Inside a gallery the arrows walk its pictures first, and carry on to the
       next work only once this one has none left that way. */
    const entry = projectConsole.entries[projectConsole.index];
    if (entry && entry.type === "gallery") {
        const next = entry.frame + step;
        if (next >= 0 && next < entry.frames.length) {
            stepGalleryFrame(projectConsole.index, step);
            return;
        }
    }

    goToConsoleEntry(projectConsole.index + step);
}

/* The id out of whichever address the link was saved as - the no-cookie domain
   the manager writes now, or the plain one earlier links carry. Picked apart by
   hand rather than by pattern: the shapes are few and the reading is plainer. */
function youtubeId(src) {
    const url = String(src || "");

    for (const mark of ["/embed/", "watch?v=", "youtu.be/"]) {
        const found = url.indexOf(mark);
        if (found < 0) continue;

        const id = url.slice(found + mark.length)
            .split("?")[0].split("&")[0].split("#")[0].split("/")[0];
        if (id.length >= 6) return id;
    }

    return "";
}

// Small and certain: every video has this one, and it is the shape of the video
function youtubeThumbUrl(src) {
    const id = youtubeId(src);
    return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : "";
}

/* Big, and only there for a video uploaded at 720 or better - which is why
   whatever asks for it has to be ready to fall back to the small one. */
function youtubePosterUrl(src) {
    const id = youtubeId(src);
    return id ? `https://img.youtube.com/vi/${id}/maxresdefault.jpg` : "";
}

/* An embed standing as its own poster, with a mark of ours on it, and the
   player not fetched until it is pressed.
   YouTube's frame arrives carrying a title bar, a share button and a red mark
   of its own, none of which anyone asked to see - and three embeds in one set
   is three players loaded to show three still pictures. Pressing it is a plain
   request to watch, so the player comes in already running. */
function buildEmbedFacade(work) {
    const facade = document.createElement("button");
    facade.type = "button";
    facade.className = "embed-facade";
    facade.setAttribute("aria-label", `Play ${work.title || "video"}`);

    const poster = youtubePosterUrl(work.src);
    if (poster) {
        const still = document.createElement("img");
        still.src = poster;
        still.alt = "";
        still.loading = "lazy";
        still.addEventListener("error", () => {
            const small = youtubeThumbUrl(work.src);
            if (small && still.src !== small) still.src = small;
        }, { once: true });
        facade.appendChild(still);
    }

    facade.appendChild(Object.assign(document.createElement("span"), {
        className: "embed-play",
        textContent: "▶"
    }));

    facade.addEventListener("click", () => {
        const player = document.createElement("iframe");
        player.src = work.src + (work.src.includes("?") ? "&" : "?") + "autoplay=1";
        player.title = work.title || "";
        player.allow = "autoplay; encrypted-media; fullscreen";
        player.allowFullscreen = true;
        facade.replaceWith(player);
    }, { once: true });

    return facade;
}

function consoleFileExt(entry) {
    if (entry.type === "video" || entry.type === "clip") return ".MP4";
    const match = /\.(png|jpe?g|webp|gif|avif)(?:[?#]|$)/i.exec(entry.src || "");
    return match ? `.${match[1].toUpperCase()}` : ".PNG";
}

function padUnit(value) {
    return String(value).padStart(2, "0");
}

/* ==========================================================
   LIGHTBOX
   Opens the full-resolution copy of a work and lets it be
   examined: scroll to zoom around the pointer, drag to pan,
   double-click to switch between fitting the screen and actual
   pixels. Scale 1 means fitted, so every zoom is measured
   outwards from whatever the screen could show to begin with.
   ========================================================== */

const lightbox = {
    el: null,
    img: null,
    video: null,
    readout: null,
    /* Where the picture sits when it is merely fitted to the screen. Every
       transform below is measured from this box, so it has to be read while no
       transform is applied. */
    base: null,
    scale: 1,
    tx: 0,
    ty: 0,
    oneToOne: 1,        // the scale at which one image pixel covers one screen pixel
    natural: "",
    pointers: new Map(),
    pinchStart: 0,
    scaleStart: 1,
    moved: false
};

const MAX_ZOOM = 12;

function initLightbox() {
    const el = document.getElementById("lightbox");
    const img = document.getElementById("lightbox-img");
    if (!el || !img) return;

    lightbox.el = el;
    lightbox.img = img;
    lightbox.video = document.getElementById("lightbox-video");
    lightbox.readout = el.appendChild(Object.assign(document.createElement("div"), {
        className: "lightbox-readout"
    }));

    document.querySelectorAll(".zoomable").forEach((node) => {
        node.addEventListener("click", (e) => {
            const source = e.currentTarget.tagName === "IMG"
                ? e.currentTarget
                : e.currentTarget.querySelector("img");
            if (source) openLightbox(source);
        });
    });

    const close = document.getElementById("close-lightbox");
    if (close) close.addEventListener("click", (e) => { e.stopPropagation(); closeLightbox(); });

    el.addEventListener("wheel", onLightboxWheel, { passive: false });
    el.addEventListener("pointerdown", onLightboxPointerDown);
    el.addEventListener("pointermove", onLightboxPointerMove);
    el.addEventListener("pointerup", onLightboxPointerUp);
    el.addEventListener("pointercancel", onLightboxPointerUp);
    el.addEventListener("dblclick", onLightboxDoubleClick);
    document.addEventListener("keydown", onLightboxKeys);
    window.addEventListener("resize", () => { if (isLightboxOpen()) measureLightbox(); });
}

const isLightboxOpen = () => Boolean(lightbox.el) && lightbox.el.style.display === "flex";

const showingClip = () => Boolean(lightbox.el) && lightbox.el.classList.contains("showing-clip");

function openLightbox(source) {
    const { el, img, video } = lightbox;
    const isClip = source.tagName === "VIDEO";

    el.style.display = "flex";
    el.classList.toggle("showing-clip", isClip);
    document.body.style.overflow = "hidden";

    if (isClip) {
        /* In the strip a clip runs silent, small and without controls. Here it
           gets its own size, its sound and a scrubber - so it picks up from
           wherever the strip had reached rather than starting over. */
        img.style.display = "none";
        if (!video) return;

        video.style.display = "block";
        video.src = source.getAttribute("src") || "";
        video.poster = source.getAttribute("poster") || "";
        video.currentTime = source.currentTime || 0;
        video.play().catch(() => {});
        lightbox.readout.textContent = "> CLIP  ·  esc to close";
        return;
    }

    img.style.display = "block";
    if (video) video.style.display = "none";

    // The strip shows the copy made for it; the lightbox wants every pixel
    img.src = source.dataset.full || source.src;
    img.alt = source.alt || "";

    lightbox.scale = 1;
    lightbox.tx = 0;
    lightbox.ty = 0;

    if (img.complete && img.naturalWidth) {
        measureLightbox();
    } else {
        img.addEventListener("load", measureLightbox, { once: true });
        lightbox.readout.textContent = "> LOADING";
    }
}

function closeLightbox() {
    if (!lightbox.el) return;
    lightbox.el.style.display = "none";
    lightbox.el.classList.remove("is-grabbing", "showing-clip");
    document.body.style.overflow = "";
    lightbox.pointers.clear();

    // Stop the download as well as the sound
    if (lightbox.video) {
        lightbox.video.pause();
        lightbox.video.removeAttribute("src");
        lightbox.video.load();
    }
}

/* Reads the fitted box with the transform cleared, which is the frame of
   reference the zoom and pan are expressed in. */
function measureLightbox() {
    const { img } = lightbox;
    if (!img.naturalWidth) return;

    img.style.transform = "none";
    const rect = img.getBoundingClientRect();
    lightbox.base = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

    /* Actual pixels means the screen's pixels, not CSS ones. On a display running
       any scaling at all, one CSS pixel is more than one device pixel, so a
       picture shown at "100%" without accounting for that is magnified by the
       scale factor and looks soft - which reads as the file being low resolution
       when it is not. */
    const dpr = window.devicePixelRatio || 1;
    lightbox.oneToOne = rect.width ? img.naturalWidth / (rect.width * dpr) : 1;
    lightbox.natural = img.naturalWidth + " x " + img.naturalHeight;

    applyLightbox();
}

/* Keeps the picture where it can be seen: filling the screen once it is bigger
   than one, and centred while it still fits. */
function clampLightbox() {
    const { base, scale } = lightbox;
    if (!base) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = base.width * scale;
    const h = base.height * scale;

    lightbox.tx = w <= vw
        ? (vw - w) / 2 - base.left
        : Math.min(-base.left, Math.max(vw - base.left - w, lightbox.tx));

    lightbox.ty = h <= vh
        ? (vh - h) / 2 - base.top
        : Math.min(-base.top, Math.max(vh - base.top - h, lightbox.ty));
}

function applyLightbox() {
    const { img, readout, scale, oneToOne, natural } = lightbox;
    if (!lightbox.base) return;

    clampLightbox();
    img.style.transform = `translate(${lightbox.tx}px, ${lightbox.ty}px) scale(${scale})`;
    lightbox.el.classList.toggle("can-pan", scale > Math.min(1, oneToOne) + 0.001);

    // Percentages are of actual pixels, so 100% is one image pixel per screen pixel
    const percent = Math.round((scale / oneToOne) * 100);
    readout.textContent = `${natural}  ·  ${percent}%  ·  scroll to zoom, double-click for 1:1`;
}

/* Zooms about a point on screen, so whatever is under the pointer stays there */
function zoomLightboxAt(nextScale, clientX, clientY) {
    const { base, scale } = lightbox;
    if (!base) return;

    /* A picture with fewer pixels than the screen area it is filling is already
       being stretched at its fitted size, so actual pixels can sit below that. */
    const floor = Math.min(1, lightbox.oneToOne);
    const limited = Math.min(MAX_ZOOM, Math.max(floor, nextScale));
    const dx = clientX - base.left;
    const dy = clientY - base.top;
    const ratio = limited / scale;

    lightbox.tx = dx - ratio * (dx - lightbox.tx);
    lightbox.ty = dy - ratio * (dy - lightbox.ty);
    lightbox.scale = limited;

    applyLightbox();
}

function onLightboxWheel(e) {
    if (!isLightboxOpen() || showingClip()) return;
    e.preventDefault();
    // A trackpad reports small deltas and a mouse wheel large ones, so the step
    // is taken from the size of the gesture rather than fixed
    const step = Math.exp(-e.deltaY * 0.0015);
    zoomLightboxAt(lightbox.scale * step, e.clientX, e.clientY);
}

function onLightboxDoubleClick(e) {
    if (!isLightboxOpen() || showingClip()) return;
    e.preventDefault();
    const atOneToOne = Math.abs(lightbox.scale - lightbox.oneToOne) < 0.01;
    zoomLightboxAt(atOneToOne ? 1 : lightbox.oneToOne, e.clientX, e.clientY);
}

function onLightboxPointerDown(e) {
    // The clip's own controls need the pointer, so only the backdrop is watched
    if (!isLightboxOpen() || (showingClip() && e.target !== lightbox.el)) return;
    lightbox.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lightbox.moved = false;

    if (lightbox.pointers.size === 2) {
        const [a, b] = [...lightbox.pointers.values()];
        lightbox.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        lightbox.scaleStart = lightbox.scale;
    }

    lightbox.el.setPointerCapture(e.pointerId);
    lightbox.el.classList.add("is-grabbing");
}

function onLightboxPointerMove(e) {
    if (!lightbox.pointers.has(e.pointerId)) return;

    const previous = lightbox.pointers.get(e.pointerId);
    lightbox.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (lightbox.pointers.size === 2) {
        const [a, b] = [...lightbox.pointers.values()];
        const spread = Math.hypot(a.x - b.x, a.y - b.y);
        if (lightbox.pinchStart > 0) {
            zoomLightboxAt(
                lightbox.scaleStart * (spread / lightbox.pinchStart),
                (a.x + b.x) / 2,
                (a.y + b.y) / 2
            );
        }
        lightbox.moved = true;
        return;
    }

    const dx = e.clientX - previous.x;
    const dy = e.clientY - previous.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) lightbox.moved = true;
    if (showingClip() || lightbox.scale <= Math.min(1, lightbox.oneToOne) + 0.001) return;

    lightbox.tx += dx;
    lightbox.ty += dy;
    applyLightbox();
}

function onLightboxPointerUp(e) {
    if (!lightbox.pointers.has(e.pointerId)) return;
    lightbox.pointers.delete(e.pointerId);
    lightbox.pinchStart = 0;
    if (!lightbox.pointers.size) lightbox.el.classList.remove("is-grabbing");

    /* A click on the backdrop closes, but only when it was a click: releasing
       after a drag that happened to end outside the picture should not. */
    if (!lightbox.moved && e.target === lightbox.el) closeLightbox();
}

function onLightboxKeys(e) {
    if (!isLightboxOpen() || e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === "Escape") {
        closeLightbox();
        e.preventDefault();
        return;
    }

    // Everything below is zooming, which only means something for a still
    if (showingClip()) return;

    const middle = [window.innerWidth / 2, window.innerHeight / 2];
    if (e.key === "+" || e.key === "=") { zoomLightboxAt(lightbox.scale * 1.4, ...middle); }
    else if (e.key === "-" || e.key === "_") { zoomLightboxAt(lightbox.scale / 1.4, ...middle); }
    else if (e.key === "0") { zoomLightboxAt(1, ...middle); }
    else if (e.key === "1") { zoomLightboxAt(lightbox.oneToOne, ...middle); }
    else return;

    e.preventDefault();
}

/* ==========================================================
   ARRANGE MODE
   The manager opens this page with ?edit=1 and shows it in a
   frame. What you see is the page itself, laid out by the same
   engine the site uses, so anything moved here is moved for
   real rather than in a drawing of it.

   Nothing is written from this side. Every change is reported
   to the manager, which holds the project data and saves it.
   ========================================================== */

const consoleEdit = {
    on: false,
    dragFrom: -1,
    /* Which works the align buttons act on. Kept as indexes into entries, the
       same currency the rest of arrange mode deals in. */
    picked: new Set()
};

const inArrangeMode = () => new URLSearchParams(window.location.search).get("edit") === "1";

/* The manager works in terms of the order the works were listed in, so each one
   remembers where it started. Reporting those positions back lets the manager
   rearrange its own copy without having to guess what moved. */
function tellManager(type, detail) {
    if (!consoleEdit.on || window.parent === window) return;
    window.parent.postMessage({
        source: "archive-arrange",
        type,
        order: projectConsole.entries.map((entry) => entry.origin),
        ...detail
    }, "*");
}

function initConsoleEditing() {
    if (!inArrangeMode() || !projectConsole.els) return;

    consoleEdit.on = true;
    document.body.classList.add("is-arranging");
    projectConsole.entries.forEach((entry, i) => { entry.origin = i; });

    projectConsole.els.slides.forEach((slide, i) => {
        if (projectConsole.free) {
            prepareSlideForPlacing(slide, i);
            return;
        }

        prepareSlideForArranging(slide);

        /* The column stacks works in order, so their place is set by dragging one
           onto another. Their width is not, and that is worth having by hand. */
        if (projectConsole.vertical) prepareSlideForColumnResize(slide, i);
    });

    // The frame is scrolled by the manager, so the pinning would only fight it
    window.addEventListener("resize", () => queueConsoleMeasure());
    /* The manager owns the snapping switch, so it stays in step with what the
       checkbox in its bar says rather than each keeping its own idea. */
    window.addEventListener("message", (e) => {
        const msg = e.data;
        if (!msg || msg.source !== "archive-manager") return;
        if (msg.type === "snap") placing.snap = Boolean(msg.on);
        if (msg.type === "push") placing.push = Boolean(msg.on);
        if (msg.type === "align") alignPicked(msg.how);
    });

    /* A click on bare canvas lets go of everything, so the buttons stop acting
       on a work you have moved on from. */
    if (projectConsole.free) {
        projectConsole.els.track.addEventListener("pointerdown", (e) => {
            if (e.target === projectConsole.els.track) pickWorks([]);
        });
    }

    tellManager("ready", { free: projectConsole.free, push: placing.push });
}

function prepareSlideForArranging(slide) {
    slide.draggable = true;

    slide.addEventListener("dragstart", (e) => {
        consoleEdit.dragFrom = projectConsole.els.slides.indexOf(slide);
        slide.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        // Firefox will not start a drag without something on the transfer
        e.dataTransfer.setData("text/plain", String(consoleEdit.dragFrom));
    });

    slide.addEventListener("dragend", () => {
        consoleEdit.dragFrom = -1;
        document.querySelectorAll(".is-dragging, .is-drop-target")
            .forEach((n) => n.classList.remove("is-dragging", "is-drop-target"));
    });

    slide.addEventListener("dragover", (e) => {
        if (consoleEdit.dragFrom < 0) return;
        e.preventDefault();
        document.querySelectorAll(".is-drop-target").forEach((n) => n.classList.remove("is-drop-target"));
        slide.classList.add("is-drop-target");
    });

    slide.addEventListener("drop", (e) => {
        if (consoleEdit.dragFrom < 0) return;
        e.preventDefault();
        e.stopPropagation();

        const to = projectConsole.els.slides.indexOf(slide);
        if (to >= 0 && to !== consoleEdit.dragFrom) moveConsoleWork(consoleEdit.dragFrom, to);
    });
}

/* Moves a work in the running order and lays the page out again from scratch.
   Everything that is kept in step with the order - the index rail, the ruler,
   the readouts - is moved with it, so the page stays consistent without a
   reload. */
function moveConsoleWork(from, to) {
    const { els, entries } = projectConsole;

    const lift = (list) => list.splice(to, 0, list.splice(from, 1)[0]);
    lift(entries);
    lift(els.slides);
    lift(els.thumbs);

    // The rail and the ruler are read in order, so both are rebuilt from it
    els.rail.replaceChildren(...els.thumbs);
    els.thumbs.forEach((thumb, i) => {
        const num = thumb.querySelector(".rail-num");
        if (num) num.textContent = padUnit(i + 1);
    });

    relayoutConsoleWorks();
    setConsoleEntry(to, true);
    tellManager("order");
}

/* Puts the works back into the track in their new order. The column places them
   itself, pairing any marked to share a line; the strip hands them to the row
   balancer, which deals them out again. */
function relayoutConsoleWorks() {
    const { els, entries, vertical } = projectConsole;

    if (vertical) {
        els.track.replaceChildren();
        let pair = null;

        entries.forEach((entry, i) => {
            const slide = els.slides[i];
            if (!entry.half) {
                pair = null;
                els.track.appendChild(slide);
                return;
            }
            if (!pair || pair.children.length >= 2) {
                pair = document.createElement("div");
                pair.className = "feed-pair";
                els.track.appendChild(pair);
            }
            pair.appendChild(slide);
        });
    } else {
        els.rows[0].replaceChildren(...els.slides);
        els.rows[1].replaceChildren();
    }

    /* The header's position readout belongs to whichever work is selected, and
       setConsoleEntry writes it, so there is nothing per-work to renumber here. */
    measureConsoleStrip();
}

/* ----------------------------------------------------------------------------
   HAND PLACING
   Free movement and resizing on the canvas layout. Positions are kept as
   fractions of the canvas width, so what is dragged here holds its proportions
   at any screen size.

   Snapping is on by default and can be turned off from the manager, or held off
   for a moment with Alt. It looks for the edges and centres of the other works
   as well as a plain grid, so things line up with each other rather than merely
   landing on round numbers.
   ---------------------------------------------------------------------------- */

const placing = {
    snap: true,
    grid: 0.01,        // a hundredth of the canvas width
    threshold: 6,      // how near, in pixels, before it takes hold
    /* Whether a work dropped onto others makes room for itself. Off, the canvas
       is what it has always been and works are free to overlap. */
    push: true,
    clearance: 0.02,   // the air left between a work and what it pushed, in canvas widths
    active: null
};

const GUIDE_ID = "snap-guides";

function guideLayer() {
    const { els } = projectConsole;
    let layer = document.getElementById(GUIDE_ID);
    if (!layer) {
        layer = document.createElement("div");
        layer.id = GUIDE_ID;
        layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:40";
        els.track.appendChild(layer);
    }
    return layer;
}

const clearGuides = () => { const l = document.getElementById(GUIDE_ID); if (l) l.replaceChildren(); };

function drawGuide(kind, at) {
    const guide = document.createElement("div");
    guide.className = "snap-guide " + kind;
    if (kind === "v") guide.style.left = at + "px";
    else guide.style.top = at + "px";
    guideLayer().appendChild(guide);
}

/* Every edge and centre worth lining up with, in canvas pixels. */
function snapLines(exceptIndex) {
    const { entries, els, windowWidth } = projectConsole;
    const vertical = [0, windowWidth / 2, windowWidth];
    const horizontal = [0];

    entries.forEach((entry, i) => {
        if (i === exceptIndex) return;
        const left = entry.x * windowWidth;
        const width = entry.wFrac * windowWidth;
        const top = entry.y * windowWidth;
        const height = slideHeight(i);

        vertical.push(left, left + width / 2, left + width);
        horizontal.push(top, top + height / 2, top + height);
    });

    return { vertical, horizontal };
}

/* Pulls a value onto the nearest line, or onto the grid if none is close. */
function snapValue(value, lines, gridPx) {
    if (!placing.snap) return { value, line: null };

    let best = null;
    let bestGap = placing.threshold;
    lines.forEach((line) => {
        const gap = Math.abs(line - value);
        if (gap < bestGap) { bestGap = gap; best = line; }
    });
    if (best !== null) return { value: best, line: best };

    return { value: Math.round(value / gridPx) * gridPx, line: null };
}

function beginPlacing(slide, index, e, mode) {
    const { entries, windowWidth } = projectConsole;
    const entry = entries[index];

    /* Dragging one of several picked works moves the lot, so the arrangement
       between them survives the move. The grabbed one still decides where the
       whole thing lands - it is the one under the pointer. */
    const moving = (mode === "move" && consoleEdit.picked.has(index))
        ? [...consoleEdit.picked]
        : [index];

    placing.active = {
        slide,
        index,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        originX: entry.x * windowWidth,
        originY: entry.y * windowWidth,
        originW: entry.wFrac * windowWidth,
        // Measured rather than worked out: only a frame has a height of its own
        originH: slide.offsetHeight,
        group: moving.map((i) => ({
            i,
            x: entries[i].x * windowWidth,
            y: entries[i].y * windowWidth
        })),
        lines: snapLines(index),
        gridPx: placing.grid * windowWidth
    };

    slide.setPointerCapture(e.pointerId);
    slide.classList.add("is-dragging");
    e.preventDefault();
}

function movePlacing(e) {
    const drag = placing.active;
    if (!drag) return;

    const { entries, els, windowWidth } = projectConsole;
    const entry = entries[drag.index];
    const held = e.altKey;               // Alt holds snapping off for a moment
    const wasSnapping = placing.snap;
    if (held) placing.snap = false;

    clearGuides();
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;

    if (drag.mode === "size") {
        const width = Math.max(windowWidth * 0.04, drag.originW + dx);
        const right = snapValue(drag.originX + width, drag.lines.vertical, drag.gridPx);
        if (right.line !== null) drawGuide("v", right.line);

        entry.wFrac = Math.max(0.04, (right.value - drag.originX) / windowWidth);

        /* A gallery is a frame rather than a picture: it holds a box you set,
           and whichever picture is showing is fitted into it. So the grip sizes
           both of its sides, where a picture only ever gets its width dragged
           and takes its height from its own shape. */
        if (isFramed(entry)) {
            const height = Math.max(windowWidth * 0.04, drag.originH + dy);
            const bottom = snapValue(drag.originY + height, drag.lines.horizontal, drag.gridPx);
            if (bottom.line !== null) drawGuide("h", bottom.line);

            entry.hFrac = Math.max(0.04, (bottom.value - drag.originY) / windowWidth);
        }
    } else {
        const left = snapValue(drag.originX + dx, drag.lines.vertical, drag.gridPx);
        const top = snapValue(drag.originY + dy, drag.lines.horizontal, drag.gridPx);
        if (left.line !== null) drawGuide("v", left.line);
        if (top.line !== null) drawGuide("h", top.line);

        /* What the grabbed work ended up moving, rather than what the pointer
           did, so anything travelling with it lands on the same snap. */
        const tookX = left.value - drag.originX;
        const tookY = top.value - drag.originY;

        drag.group.forEach((from) => {
            const moved = entries[from.i];
            moved.x = (from.x + tookX) / windowWidth;
            moved.y = Math.max(0, (from.y + tookY) / windowWidth);
        });
    }

    placing.snap = wasSnapping;

    /* Straight to the elements: going through a full measure on every frame
       would recompute the canvas height and fight the drag. */
    if (drag.mode === "size") {
        drag.slide.style.width = (entry.wFrac * windowWidth) + "px";
        if (isFramed(entry)) {
            drag.slide.style.height = (entry.hFrac * windowWidth) + "px";
        }
    } else {
        drag.group.forEach((from) => {
            const slide = els.slides[from.i];
            slide.style.left = (entries[from.i].x * windowWidth) + "px";
            slide.style.top = (entries[from.i].y * windowWidth) + "px";
        });
    }
}

function endPlacing(e) {
    const drag = placing.active;
    if (!drag) return;

    drag.slide.classList.remove("is-dragging");
    try { drag.slide.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    placing.active = null;
    clearGuides();

    /* Measured before the pushing and again after it. What a work has landed on
       is a question about heights, and a picture's height only settles once the
       layout has been applied - so the canvas is settled, room is made, and then
       it is settled again around the works that moved. */
    measureConsoleStrip();
    if (placing.push) {
        // The whole group was put there on purpose, so none of it gives way
        makeRoomFor(drag.group.map((from) => from.i));
        measureConsoleStrip();
    }

    tellManager("place", { placements: placedWorks() });
}

/* Making room. A work put down in the middle of an arrangement does not cover
   what was already there: whatever it lands on moves down far enough to clear
   it, and whatever that one then lands on moves too, so dropping something in
   opens a gap rather than hiding a picture.
   Only works that overlap it across the canvas are moved - something off in
   another column has no quarrel with it and is left alone - and only ones that
   start at or below it, since a work you have slid up under another is a
   composition, not a collision. */
function makeRoomFor(movedIndexes) {
    const { entries, els, windowWidth } = projectConsole;
    if (!windowWidth || !entries.length) return;

    const boxOf = (i) => ({
        left: entries[i].x,
        right: entries[i].x + entries[i].wFrac,
        top: entries[i].y,
        bottom: entries[i].y + slideHeight(i) / windowWidth
    });

    // What was just put down stays where it was put; everything else may give way
    const placed = new Set(movedIndexes);
    if (!placed.size) return;

    /* Only what the placed work runs into, and what those in turn run into. An
       overlap elsewhere on the canvas was arranged on purpose and is none of
       this function's business. */
    const affected = new Set(placed);

    /* Settled in rounds, working from the top down each time, because moving one
       work changes what is beneath it - and two works shoved aside together
       would otherwise be left sitting on each other. A work only ever moves
       down, so the rounds run out rather than circling; the count is a bound on
       a canvas that cannot settle, not a normal way to finish. */
    for (let round = 0; round < entries.length * 2 + 2; round++) {
        const order = [...affected].sort((a, b) => boxOf(a).top - boxOf(b).top);
        let changed = false;

        for (const i of order) {
            const pusher = boxOf(i);

            entries.forEach((entry, j) => {
                if (j === i || placed.has(j)) return;

                const box = boxOf(j);
                const across = box.left < pusher.right && box.right > pusher.left;
                const under = box.top >= pusher.top;
                const touching = box.top < pusher.bottom;
                if (!across || !under || !touching) return;

                entry.y = pusher.bottom + placing.clearance;
                affected.add(j);
                changed = true;
            });
        }

        if (!changed) return;
    }
}

const placedWorks = () => projectConsole.entries.map((entry) => ({
    origin: entry.origin,
    x: Number(entry.x.toFixed(4)),
    y: Number(entry.y.toFixed(4)),
    w: Number(entry.wFrac.toFixed(4)),
    h: entry.hFrac != null ? Number(entry.hFrac.toFixed(4)) : null
}));

/* Widening or narrowing one work in the column. Its place in the order is left
   alone - that is what dragging it onto another is for - so only the width
   changes, and the picture's own shape gives the height. */
function prepareSlideForColumnResize(slide, index) {
    let from = null;

    slide.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const box = slide.getBoundingClientRect();
        if (e.clientX < box.right - 22 || e.clientY < box.bottom - 22) return;

        from = { x: e.clientX, width: slide.offsetWidth };
        slide.setPointerCapture(e.pointerId);
        slide.draggable = false;      // or the browser starts a reorder instead
        slide.classList.add("is-dragging");
        e.preventDefault();
        e.stopPropagation();
    });

    slide.addEventListener("pointermove", (e) => {
        if (!from) return;
        const { entries, windowWidth } = projectConsole;

        let width = from.width + (e.clientX - from.x);
        // Snapping here is to a share of the window, which is what reads as tidy
        if (placing.snap && !e.altKey) {
            const step = windowWidth / 12;
            width = Math.round(width / step) * step;
        }

        const fraction = Math.min(1, Math.max(0.08, width / windowWidth));
        entries[index].wFrac = fraction;
        slide.style.width = Math.round(fraction * windowWidth) + "px";
    });

    const finish = (e) => {
        if (!from) return;
        from = null;
        slide.draggable = true;
        slide.classList.remove("is-dragging");
        try { slide.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

        measureConsoleStrip();
        tellManager("size", {
            sizes: projectConsole.entries.map((entry) => ({
                origin: entry.origin,
                w: entry.wFrac > 0 ? Number(entry.wFrac.toFixed(4)) : null
            }))
        });
    };

    slide.addEventListener("pointerup", finish);
    slide.addEventListener("pointercancel", finish);
}

/* Which works the align buttons act on. The manager is told the count so it can
   grey the buttons out while nothing is picked. */
function pickWorks(indexes) {
    consoleEdit.picked = new Set(indexes);
    projectConsole.els.slides.forEach((slide, i) => {
        slide.classList.toggle("is-picked", consoleEdit.picked.has(i));
    });
    tellManager("picked", { count: consoleEdit.picked.size });
}

/* Where the picked works are put.
   Centring moves them as one block, so a row stays a row instead of collapsing
   into a stack. Aligning an edge lines them up on each other - or on the canvas
   when only one is picked, which is what makes the buttons worth anything
   before you have picked a second. */
function alignPicked(how) {
    const { entries, els, windowWidth } = projectConsole;
    const picked = [...consoleEdit.picked];
    if (!picked.length || !windowWidth) return;

    const boxes = picked.map((i) => ({
        i,
        left: entries[i].x * windowWidth,
        top: entries[i].y * windowWidth,
        width: entries[i].wFrac * windowWidth,
        height: slideHeight(i)
    }));

    const canvasHeight = projectConsole.canvas * windowWidth;
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.left + b.width));
    const top = Math.min(...boxes.map((b) => b.top));
    const bottom = Math.max(...boxes.map((b) => b.top + b.height));

    if (how === "center-h" || how === "center-v") {
        const shift = how === "center-h"
            ? { x: (windowWidth - (right - left)) / 2 - left, y: 0 }
            : { x: 0, y: (canvasHeight - (bottom - top)) / 2 - top };

        boxes.forEach((box) => {
            entries[box.i].x = (box.left + shift.x) / windowWidth;
            entries[box.i].y = Math.max(0, (box.top + shift.y) / windowWidth);
        });
    } else {
        const alone = boxes.length === 1;
        const edge = how === "left"
            ? (alone ? 0 : left)
            : (alone ? windowWidth : right);

        boxes.forEach((box) => {
            entries[box.i].x = (how === "left" ? edge : edge - box.width) / windowWidth;
        });
    }

    measureConsoleStrip();
    tellManager("place", { placements: placedWorks() });
}

/* A work is moved by dragging it and resized by dragging its bottom-right
   corner, which is the region the grip is drawn over. */
function prepareSlideForPlacing(slide, index) {
    slide.draggable = false;

    slide.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        const box = slide.getBoundingClientRect();
        const onGrip = (e.clientX > box.right - 22) && (e.clientY > box.bottom - 22);

        /* Shift adds to the pick. Otherwise grabbing a work that is already
           picked leaves the pick alone - that is how a group gets dragged -
           and grabbing any other one starts a fresh pick from it. */
        if (e.shiftKey) {
            const next = new Set(consoleEdit.picked);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            pickWorks(next);
        } else if (!consoleEdit.picked.has(index)) {
            pickWorks([index]);
        }

        beginPlacing(slide, index, e, onGrip ? "size" : "move");
    });

    slide.addEventListener("pointermove", movePlacing);
    slide.addEventListener("pointerup", endPlacing);
    slide.addEventListener("pointercancel", endPlacing);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeProjectPageInteractions, { once: true });
} else {
    initializeProjectPageInteractions();
}
