/*
 * Generates the project pages and the tape list from data/projects.json.
 *
 * data/projects.json is the source of truth. Everything this writes is a build
 * artifact - editing filepage/*.html or js/files.js by hand will be overwritten
 * the next time the manager saves. Edit the JSON, or use `npm run manage`.
 *
 *   node tools/build-pages.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data", "projects.json");
const PAGES = path.join(ROOT, "filepage");

/* Paths in projects.json are relative to the repo root, but the pages that use
   them sit one level down in filepage/, so local assets need stepping back up.
   Anything already absolute - an external image, a YouTube embed - is left be. */
const assetUrl = (value) => {
    const url = String(value || "").trim();
    if (!url || /^([a-z]+:)?\/\//i.test(url) || url.startsWith("data:")) return url;
    return "../" + url.replace(/^(\.\.?\/)+/, "");
};

const esc = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/* The version check and the asset loaders are identical on every project page,
   so they live here once instead of being copied into each of them. */
function pageHead(project) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <script>
        (() => {
            const VERSION_KEY = 'portfolio_version';
            const RELOAD_GUARD_KEY = 'portfolio_reload_guard';
            const stripVersionParam = () => {
                try {
                    const url = new URL(window.location.href);
                    if (!url.searchParams.has('v')) return;
                    url.searchParams.delete('v');
                    const nextUrl = \`\${url.pathname}\${url.search}\${url.hash}\`;
                    window.history.replaceState({}, document.title, nextUrl);
                } catch {
                    // Ignore URL rewrite issues.
                }
            };

            const initialVersion = localStorage.getItem(VERSION_KEY) || '';
            window.__portfolioVersion = initialVersion;
            window.getVersionedAssetUrl = (path) => {
                const version = window.__portfolioVersion || localStorage.getItem(VERSION_KEY) || '';
                if (!version) return path;
                const sep = path.includes('?') ? '&' : '?';
                return \`\${path}\${sep}v=\${encodeURIComponent(version)}\`;
            };

            fetch(\`../version.json?ts=\${Date.now()}\`, {
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache' }
            })
                .then((response) => {
                    if (!response.ok) {
                        throw new Error(\`Version fetch failed: \${response.status}\`);
                    }
                    return response.json();
                })
                .then((data) => {
                    const liveVersion = (typeof data?.version === 'string') ? data.version.trim() : '';
                    if (!liveVersion) return;

                    const localVersion = localStorage.getItem(VERSION_KEY);

                    if (!localVersion) {
                        localStorage.setItem(VERSION_KEY, liveVersion);
                        window.__portfolioVersion = liveVersion;
                        stripVersionParam();
                        return;
                    }

                    if (localVersion === liveVersion) {
                        window.__portfolioVersion = liveVersion;
                        if (sessionStorage.getItem(RELOAD_GUARD_KEY) === liveVersion) {
                            sessionStorage.removeItem(RELOAD_GUARD_KEY);
                        }
                        stripVersionParam();
                        return;
                    }

                    localStorage.setItem(VERSION_KEY, liveVersion);
                    window.__portfolioVersion = liveVersion;

                    const url = new URL(window.location.href);
                    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === liveVersion || url.searchParams.get('v') === liveVersion) {
                        stripVersionParam();
                        return;
                    }
                    sessionStorage.setItem(RELOAD_GUARD_KEY, liveVersion);
                    url.searchParams.set('v', liveVersion);
                    window.location.replace(url.toString());
                })
                .catch(() => {
                    // Keep current cached version token on temporary network failures.
                });
        })();
    </script>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ARCHIVE // ${esc(project.archiveName)}</title>
    <style>body{background:#050805}</style>

    <link href="https://fonts.googleapis.com/css2?family=VT323&display=swap" rel="stylesheet">

    <script>
        (() => {
            const getUrl = (path) => (
                typeof window.getVersionedAssetUrl === 'function'
                    ? window.getVersionedAssetUrl(path)
                    : path
            );

            const baseStyleLink = document.createElement('link');
            baseStyleLink.rel = 'stylesheet';
            baseStyleLink.href = getUrl('../style.css');
            document.head.appendChild(baseStyleLink);

            const pageStyleLink = document.createElement('link');
            pageStyleLink.rel = 'stylesheet';
            pageStyleLink.href = getUrl('../project.css');
            document.head.appendChild(pageStyleLink);
        })();
    </script>
</head>`;
}

const pageFoot = () => `    <div id="lightbox" class="lightbox-overlay" style="display: none;">
        <span id="close-lightbox">[X]</span>
        <img id="lightbox-img" src="" alt="Full Screen">
        <video id="lightbox-video" controls playsinline style="display: none;"></video>
    </div>

    <script>
        (() => {
            const getUrl = (path) => (
                typeof window.getVersionedAssetUrl === 'function'
                    ? window.getVersionedAssetUrl(path)
                    : path
            );

            const navbarScript = document.createElement('script');
            navbarScript.src = getUrl('../navbar.js');
            navbarScript.async = false;
            document.body.appendChild(navbarScript);

            const projectScript = document.createElement('script');
            projectScript.src = getUrl('../js/project.js');
            projectScript.async = false;
            document.body.appendChild(projectScript);
        })();
    </script>
</body>
</html>
`;

/* One picture, in the shape collectConsoleEntries() in js/project.js reads: the
   copies the manager made beside it, the size it really is, and two candidates
   for the browser to choose between.
   Two candidates, and it takes whichever suits the box it ends up drawing into
   and the density it is drawing on. sizes is a standing estimate of how wide a
   slide gets - without one the browser assumes the full page width and fetches
   the largest copy before the strip can correct it. The strip replaces it with
   the measured width once the layout settles. */
function imgTag(pic, alt, cls, extra = "") {
    // Only emitted when the manager made a separate copy at that size
    const thumb = pic.thumb ? ` data-thumb="${esc(assetUrl(pic.thumb))}"` : "";
    const full = pic.full ? ` data-full="${esc(assetUrl(pic.full))}"` : "";
    const size = (pic.w && pic.h) ? ` width="${pic.w}" height="${pic.h}"` : "";

    const offersBoth = pic.full && pic.w && pic.viewW && pic.full !== pic.src;
    const srcset = offersBoth
        ? ` srcset="${esc(assetUrl(pic.src))} ${pic.viewW}w, ${esc(assetUrl(pic.full))} ${pic.w}w" sizes="45vw"`
        : "";

    return `<img src="${esc(assetUrl(pic.src))}"${srcset}${thumb}${full}${size}${extra} alt="${alt}" class="${cls}" loading="lazy">`;
}

/* One work. The console reads its title and notes out of .module-desc, and its
   thumbnail and full-size copy off the img, so the shapes here are what
   collectConsoleEntries() in js/project.js expects to find. */
function workBlock(work) {
    const title = esc(work.title || "UNTITLED");
    const body = esc(work.body || "");
    const notes = body ? `\n                    <p>&gt; ${body}</p>` : "";

    /* Set by hand, as fractions of the window width so the arrangement scales
       together rather than coming apart on a narrow screen. Any kind of work can
       be placed, so this is settled before the type picks its markup. The placed
       width is its own field: `w` is the picture's real pixel width, and one
       written into the other leaves a work with no shape it can be drawn at. */
    const placed = (work.x != null && work.y != null)
        ? ` data-x="${work.x}" data-y="${work.y}"`
        : "";
    const spot = placed
        + (work.wf != null ? ` data-w="${work.wf}"` : "")
        // A gallery is a frame, and a frame is a box rather than a picture shape
        + (work.hf != null ? ` data-h="${work.hf}"` : "");

    /* Furniture. A note carries words and a spacer carries nothing, and both
       carry a place on the canvas. Neither is an asset, so neither is counted
       in the index or given anything to load. */
    if (work.type === "note") {
        // Only written when it is not the plain size, so the markup stays quiet
        const scale = (work.ts && work.ts !== 1) ? ` data-ts="${work.ts}"` : "";

        return `            <div class="media-module note-module animate-in"${spot}${scale}>
                <div class="module-desc">
                    <p>&gt; ${title}</p>${notes}
                </div>
            </div>`;
    }

    if (work.type === "spacer") {
        return `            <div class="media-module spacer-module animate-in"${spot}></div>`;
    }

    if (work.type === "clip") {
        /* Autoplaying needs muted and playsinline: a browser refuses to start a
           clip on its own otherwise, and a phone would take it fullscreen. */
        const poster = work.poster ? ` poster="${esc(assetUrl(work.poster))}"` : "";
        const thumb = work.thumb ? ` data-thumb="${esc(assetUrl(work.thumb))}"` : "";
        const size = (work.w && work.h) ? ` width="${work.w}" height="${work.h}"` : "";

        return `            <div class="media-module clip-module animate-in">
                <div class="module-desc top-desc">
                    <p>&gt; ${title}</p>${notes}
                </div>
                <div class="video-frame">
                    <video src="${esc(assetUrl(work.src))}"${poster}${thumb}${size}${spot}
                           class="scalable-media" autoplay muted loop playsinline preload="metadata"></video>
                </div>
            </div>`;
    }

    /* Several pictures held as one work: one place in the running order, one
       slot on a hand-placed canvas, and the page steps through them in it. */
    /* Two pictures of the same thing, one laid over the other, with a line the
       reader drags across to trade one for the other. Only ever two: a third
       would have nowhere to go. */
    if (work.type === "compare") {
        const pair = (work.frames || []).slice(0, 2)
            .map((frame, i) => "                    " + imgTag(
                frame,
                esc(frame.title || `${title}_${i === 0 ? "BEFORE" : "AFTER"}`),
                "compare-frame"
            ))
            .join(String.fromCharCode(10));

        return `            <div class="media-module compare-module animate-in"${spot}>
                <div class="module-desc top-desc">
                    <p>&gt; ${title}</p>${notes}
                </div>
                <div class="compare-frames">
${pair}
                </div>
            </div>`;
    }

    if (work.type === "gallery") {
        /* A set holds whatever it was given - pictures, clips, embeds - so each
           frame is written the way its own kind wants. A frame from before a set
           could hold anything says nothing about its kind, and back then a frame
           was always a picture. */
        const frames = (work.frames || [])
            .map((frame, i) => {
                const alt = esc(frame.title || `${title}_${String(i + 1).padStart(2, "0")}`);
                const pad = "                    ";

                if (frame.type === "clip") {
                    const poster = frame.poster ? ` poster="${esc(assetUrl(frame.poster))}"` : "";
                    const thumb = frame.thumb ? ` data-thumb="${esc(assetUrl(frame.thumb))}"` : "";
                    const size = (frame.w && frame.h) ? ` width="${frame.w}" height="${frame.h}"` : "";
                    return pad + `<video src="${esc(assetUrl(frame.src))}"${poster}${thumb}${size}`
                        + ` title="${alt}" class="gallery-frame zoomable" muted loop playsinline preload="metadata"></video>`;
                }

                if (frame.type === "video") {
                    return pad + `<iframe src="${esc(frame.src)}" title="${alt}"`
                        + ` class="gallery-frame" loading="lazy" frameborder="0" allowfullscreen></iframe>`;
                }

                return pad + imgTag(frame, alt, "gallery-frame zoomable");
            })
            .join("\n");

        return `            <div class="media-module gallery-module animate-in"${spot}>
                <div class="module-desc top-desc">
                    <p>&gt; ${title}</p>${notes}
                </div>
                <div class="gallery-frames">
${frames}
                </div>
            </div>`;
    }

    if (work.type === "video") {
        return `            <div class="media-module video-module animate-in">
                <div class="module-desc top-desc">
                    <p>&gt; ${title}</p>${notes}
                </div>
                <div class="video-frame">
                    <iframe src="${esc(work.src)}"${spot}
                            class="scalable-media" frameborder="0" allowfullscreen>
                    </iframe>
                </div>
            </div>`;
    }

    // Willing to share a line with the next one, in the column layout
    const half = work.half ? ` data-half="1"` : "";

    return `            <div class="media-module animate-in">
                <div class="image-frame">
                    ${imgTag(work, title, "scalable-media zoomable", half + spot)}
                </div>
                <div class="module-desc">
                    <p>&gt; ${title}</p>${notes}
                </div>
            </div>`;
}

function metaBlock(project) {
    const fields = (project.meta || []).map((field) => `                <div class="meta-field">
                    <span class="meta-label">&gt; ${esc(field.label)}</span>
                    <span class="meta-value">${esc(field.value)}</span>
                </div>`).join("\n");

    return `            <div class="project-meta">
${fields}
            </div>`;
}

/* Where the reader goes next, taken from the running order rather than written
   into each page, so reordering projects cannot leave a link pointing nowhere. */
function tailSections(project, index, projects) {
    const next = projects[(index + 1) % projects.length];
    const related = projects.filter((p) => p.slug !== project.slug).slice(0, 3);

    const cards = related.map((p) => {
        const cover = (p.works || []).find((w) => w.type !== "video");
        const thumb = cover ? (cover.thumb || cover.src) : "";
        const image = thumb
            ? `<img src="${esc(assetUrl(thumb))}" alt="${esc(p.title)}" loading="lazy">`
            : `<span class="card-empty">&gt; NO_PREVIEW</span>`;

        return `                <a href="${esc(p.slug)}.html" class="related-work-card">
                    <div class="card-thumb">
                        ${image}
                    </div>
                    <span class="card-title">${esc(p.archiveName)}.DAT</span>
                    <span class="card-cat">&gt; ${esc(p.category)}</span>
                </a>`;
    }).join("\n");

    return `        <div class="next-project-section">
            <span class="next-project-label">&gt; NEXT_FILE</span>
            <a href="${esc(next.slug)}.html" class="next-project-btn">
                ARCHIVE_FILE: ${esc(next.archiveName)}.DAT <span class="next-arrow">&#8594;</span>
            </a>
        </div>

        <div class="related-work-section">
            <div class="related-work-header">&gt; RELATED_ARCHIVES</div>
            <div class="related-work-grid">
${cards}
            </div>
        </div>`;
}

function buildPage(project, index, projects) {
    const works = (project.works || []).length
        ? project.works.map(workBlock).join("\n\n")
        : `            <div class="media-module animate-in">
                <div class="module-desc">
                    <p>&gt; NO_FILES</p>
                    <p>&gt; This archive has no works yet. Run npm run manage to add them.</p>
                </div>
            </div>`;

    return `${pageHead(project)}
<body>

    <div class="scroll-progress-bar" id="scroll-progress"></div>

    <main class="crt-window">

        <header class="window-header">
            <span class="glitch-text">&gt; ARCHIVE_FILE: ${esc(project.archiveName)}.DAT</span>
            <div class="header-right">
                <span>[ STATUS: DECRYPTED ]</span>
                <a href="../index.html" class="eject-btn" id="eject-btn" data-tape-index="${index}">■ EJECT</a>
            </div>
        </header>

        <div class="project-grid" data-layout="${["scroll", "free"].includes(project.layout) ? project.layout : "strip"}" data-canvas="${Number(project.canvas) || 1.4}">

${metaBlock(project)}

${works}

        </div>

${tailSections(project, index, projects)}

    </main>

${pageFoot()}`;
}

/* The tape list the index page reads. Generated from the same file so a tape can
   never point at a project page that does not exist. */
// How many frames the index will show for one project
const PREVIEW_MAX = 6;

/* Paths in the tape list are read from the site root, where index.html sits -
   not from filepage/, which is what assetUrl above is for. */
const rootUrl = (value) => String(value || "").trim().replace(new RegExp("^([.]{1,2}/)+"), "");

const youtubeId = (src) => {
    const url = String(src || "");
    for (const mark of ["/embed/", "watch?v=", "youtu.be/"]) {
        const found = url.indexOf(mark);
        if (found < 0) continue;
        const id = url.slice(found + mark.length)
            .split("?")[0].split("&")[0].split("#")[0].split("/")[0];
        if (id.length >= 6) return id;
    }
    return "";
};

/* Everything in a project that could stand for it in the index: pictures,
   clips and embeds wherever they sit, the ones held inside a set or a
   comparison included. A note or a spacer is furniture, and the thing holding
   frames is not itself something to show. */
function previewableWorks(project) {
    const found = [];

    for (const work of project.works || []) {
        for (const item of work.frames || [work]) {
            if (item.type === "note" || item.type === "spacer") continue;
            if (item.frames || !item.src) continue;
            found.push(item);
        }
    }

    return found;
}

/* What one of them looks like in the strip. A clip plays there; an embed stands
   as the still the service keeps for it, since loading a player to answer a
   hover costs more than the page being previewed; a picture is its small copy,
   the frames being only a couple of hundred pixels across. */
function previewShot(item) {
    if (item.type === "clip") {
        return {
            /* The small copy, made for exactly this. Without one the finished
               clip is played instead, which works but asks a visitor to
               download a hundred times what the frame can show. */
            src: rootUrl(item.preview || item.src),
            poster: rootUrl(item.poster || item.thumb || ""),
            motion: true,
            w: item.w || 0,
            h: item.h || 0
        };
    }

    if (item.type === "video") {
        const id = youtubeId(item.src);
        if (!id) return null;
        return {
            src: "https://img.youtube.com/vi/" + id + "/maxresdefault.jpg",
            // Not every video has the big still; this one always exists
            small: "https://img.youtube.com/vi/" + id + "/mqdefault.jpg",
            play: true,
            // What the index loads if it decides to let the video run
            id,
            w: 16,
            h: 9
        };
    }

    return { src: rootUrl(item.thumb || item.src), w: item.w || 0, h: item.h || 0 };
}

/* What stands for a project in the index. Whatever was chosen by hand, in the
   order it was chosen; otherwise the first clip and then the pictures - which
   is what the index used to work out for itself by fetching and reading the
   whole project page on every hover. */
function previewFor(project) {
    const all = previewableWorks(project);
    const chosen = (project.cover || [])
        .map((src) => all.find((item) => rootUrl(item.src) === rootUrl(src)))
        .filter(Boolean);

    if (!chosen.length) {
        const clip = all.find((item) => item.type === "clip");
        const rest = all.filter((item) => item !== clip && item.type !== "video");
        chosen.push(...(clip ? [clip] : []), ...rest);
    }

    return chosen.map(previewShot).filter(Boolean).slice(0, PREVIEW_MAX);
}

function buildTapeList(projects) {
    const entries = projects.map((p) => `    {
        title: ${JSON.stringify(p.title)},
        category: ${JSON.stringify(p.category)},
        shortDesc: ${JSON.stringify(p.shortDesc)},
        url: ${JSON.stringify("filepage/" + p.slug + ".html")},
        preview: ${JSON.stringify(previewFor(p))}
    }`).join(",\n");

    return `// GENERATED FILE - do not edit.
// Written by tools/build-pages.mjs from data/projects.json.
// Change the projects there, or run: npm run manage

export const projectData = [
${entries}
];
`;
}

export function buildPages() {
    const { projects } = JSON.parse(fs.readFileSync(DATA, "utf8"));
    if (!Array.isArray(projects) || !projects.length) {
        throw new Error("data/projects.json has no projects");
    }

    fs.mkdirSync(PAGES, { recursive: true });

    const written = new Set();
    projects.forEach((project, i) => {
        const file = path.join(PAGES, project.slug + ".html");
        fs.writeFileSync(file, buildPage(project, i, projects));
        written.add(project.slug + ".html");
    });

    // A project removed from the JSON should not leave its page behind
    for (const name of fs.readdirSync(PAGES)) {
        if (name.endsWith(".html") && !written.has(name)) {
            fs.rmSync(path.join(PAGES, name));
        }
    }

    fs.writeFileSync(path.join(ROOT, "js", "files.js"), buildTapeList(projects));

    return {
        projects: projects.length,
        works: projects.reduce((n, p) => n + (p.works || []).length, 0)
    };
}

// Only report when run straight from the command line, not when the server imports it
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const result = buildPages();
    console.log(`built ${result.projects} project pages (${result.works} works) + js/files.js`);
}
