/*
 * The project manager. Runs on this machine only:
 *
 *   npm run manage      ->  http://127.0.0.1:4321/manage
 *
 * It serves the site so you can preview it over http, and exposes a small API
 * the admin page uses to read and write data/projects.json, upload images and
 * regenerate the project pages.
 *
 * Nothing here is meant to face the internet - it binds to the loopback address
 * and has no authentication, because the only thing that can reach it is you.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeClipPreview, hasFfmpeg } from "../clip-preview.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DATA = path.join(ROOT, "data", "projects.json");
const IMAGES = path.join(ROOT, "images", "projects");
const ADMIN = path.join(ROOT, "tools", "manage", "admin.html");
const BUILDER = path.join(ROOT, "tools", "build-pages.mjs");

/* The builder is read again whenever its file has changed rather than being
   imported once at startup. Imported once, a manager left running while the
   builder was edited went on writing pages from the version that was on disk
   when it started - it would report a clean save, and quietly publish pages
   the current builder would never have produced. The version in the query is
   what makes the module system fetch it afresh; without one it hands back the
   copy it already has. */
let builder = null;
let builderStamp = 0;

async function buildPages() {
    const stamp = fs.statSync(BUILDER).mtimeMs;
    if (!builder || stamp !== builderStamp) {
        builder = await import(pathToFileURL(BUILDER).href + "?v=" + stamp);
        builderStamp = stamp;
        console.log("  builder loaded");
    }
    return builder.buildPages();
}

const PORT = Number(process.env.PORT) || 4321;
const MAX_BODY = 96 * 1024 * 1024; // one uncompressed render, with room to spare

/* Clips are committed to the repository like everything else, and GitHub starts
   warning about single files past 50MB and refuses them outright at 100MB. This
   keeps them on the safe side of that, and short enough to be worth autoplaying. */
const MAX_CLIP = 50 * 1024 * 1024;

// Formats a browser will actually play inline. .mov usually will not.
const CLIP_TYPES = { ".mp4": "video/mp4", ".webm": "video/webm" };

/* Sizes the site actually asks for. The strip shows a work about 650px wide on a
   1600px screen and the rail draws its thumbnails at 68-84px, so shipping the
   original render to either of them wastes most of what it downloads.
   The full copy is not in this list: it keeps every pixel it arrived with, so
   the lightbox has something real to zoom into. */
const SIZES = [
    { key: "view", edge: 2048, quality: 82 },   // the strip
    { key: "thumb", edge: 400, quality: 70 }    // the index rail
];

const FULL_QUALITY = 92;

/* Resizing is a bonus, not a requirement: without sharp the manager still works,
   it just stores one copy of what you gave it. */
let sharp = null;
try {
    ({ default: sharp } = await import("sharp"));
} catch {
    console.log("  ! sharp is not installed - images will be stored at their original size.");
    console.log("    Run  npm i -D sharp  to have the manager resize them on upload.\n");
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
    ".ico": "image/x-icon",
    ".glb": "model/gltf-binary",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".ttf": "font/ttf",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};

const json = (res, code, body) => {
    const text = JSON.stringify(body);
    res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text) });
    res.end(text);
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY) {
                reject(new Error("Upload is larger than " + Math.round(MAX_BODY / 1024 / 1024) + "MB"));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

/* One path segment, safe to join onto a directory. Anything that could climb out
   of the images folder or collide with the size suffixes is stripped here. */
const safeName = (value) => String(value || "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "work";

const isSlug = (value) => /^[a-z0-9_-]{1,60}$/i.test(String(value || ""));

function uniqueBase(dir, base) {
    let name = base;
    let n = 2;
    const taken = () => fs.readdirSync(dir).some((f) => f.startsWith(name + "-"));
    while (taken()) {
        name = base + "-" + n++;
    }
    return name;
}

/* A clip is stored exactly as given - re-encoding video needs ffmpeg, and one
   already small enough to commit has been encoded once already. Its poster comes
   from the browser, which grabbed a frame before uploading. */
async function handleClip(payload, dir, base, rel) {
    const ext = path.extname(payload.name || "").toLowerCase();
    if (!CLIP_TYPES[ext]) {
        throw new Error(`${ext || "That file"} will not play in a browser — use .mp4 or .webm`);
    }

    const buffer = Buffer.from(payload.data, "base64");
    if (buffer.length > MAX_CLIP) {
        throw new Error(
            `${Math.round(buffer.length / 1024 / 1024)}MB is over the ${MAX_CLIP / 1024 / 1024}MB clip limit — ` +
            "shorten it, or put it on YouTube and use + VIDEO"
        );
    }

    const clipFile = base + "-clip" + ext;
    fs.writeFileSync(path.join(dir, clipFile), buffer);

    const result = {
        type: "clip",
        src: rel(clipFile),
        w: payload.w || 0,
        h: payload.h || 0,
        bytes: buffer.length
    };

    /* A small copy for the index to play on a hover. The finished clip can be
       any size a render came out at - the one this replaces was 3000x4000 at
       twenty megabits - and the index shows it in a frame a couple of hundred
       pixels tall. Made here for the same reason the pictures get a thumbnail. */
    const previewFile = makeClipPreview(path.join(dir, clipFile));
    if (previewFile) {
        result.preview = rel(path.basename(previewFile));
        result.bytes += fs.statSync(previewFile).size;
        console.log("  preview  " + path.basename(previewFile)
            + "  " + Math.round(fs.statSync(previewFile).size / 1024) + "KB"
            + "  (from " + Math.round(buffer.length / 1048576) + "MB)");
    }

    // The still the browser grabbed: shown before the clip plays, and in the rail
    if (payload.poster) {
        const poster = Buffer.from(payload.poster, "base64");
        if (sharp) {
            const posterFile = base + "-poster.webp";
            const thumbFile = base + "-thumb.webp";
            await sharp(poster).resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
                .webp({ quality: 82 }).toFile(path.join(dir, posterFile));
            await sharp(poster).resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true })
                .webp({ quality: 70 }).toFile(path.join(dir, thumbFile));
            result.poster = rel(posterFile);
            result.thumb = rel(thumbFile);
            result.bytes += fs.statSync(path.join(dir, posterFile)).size
                + fs.statSync(path.join(dir, thumbFile)).size;
        } else {
            const posterFile = base + "-poster.jpg";
            fs.writeFileSync(path.join(dir, posterFile), poster);
            result.poster = rel(posterFile);
            result.thumb = rel(posterFile);
            result.bytes += poster.length;
        }
    }

    return result;
}

async function handleUpload(payload) {
    if (!isSlug(payload.slug)) throw new Error("Bad project slug");
    if (!payload.data) throw new Error("No file data");

    const dir = path.join(IMAGES, payload.slug);
    fs.mkdirSync(dir, { recursive: true });

    const base = uniqueBase(dir, safeName(payload.name));
    const rel = (file) => "images/projects/" + payload.slug + "/" + file;

    if (payload.kind === "clip") return handleClip(payload, dir, base, rel);

    const buffer = Buffer.from(payload.data, "base64");

    if (!sharp) {
        // Store what we were given, under all three names, so the page markup
        // stays the same shape whether or not resizing was available.
        const ext = (path.extname(payload.name || "") || ".jpg").toLowerCase();
        const file = base + ext;
        fs.writeFileSync(path.join(dir, file), buffer);
        return { src: rel(file), thumb: rel(file), full: rel(file), w: payload.w || 0, h: payload.h || 0 };
    }

    const written = {};
    const originalExt = (path.extname(payload.name || "") || ".jpg").toLowerCase();
    let viewW = 0;

    for (const size of SIZES) {
        const file = base + "-" + size.key + ".webp";
        const out = await sharp(buffer)
            .rotate() // honour the camera's orientation tag before it is discarded
            .resize({ width: size.edge, height: size.edge, fit: "inside", withoutEnlargement: true })
            .webp({ quality: size.quality })
            .toFile(path.join(dir, file));
        written[size.key] = rel(file);

        // A picture smaller than the cap comes out at its own width, not the cap
        if (size.key === "view") viewW = out.width;
    }

    /* The full copy keeps its original resolution - nothing is scaled away, so the
       lightbox can be zoomed to actual pixels. It is still offered as WebP, but
       only if that turns out smaller: re-encoding an already-compressed file
       often is not, and these all live in the repo. */
    const fullWebp = base + "-full.webp";
    await sharp(buffer)
        .rotate()
        .webp({ quality: FULL_QUALITY })
        .toFile(path.join(dir, fullWebp));

    const encodedSize = fs.statSync(path.join(dir, fullWebp)).size;
    let fullBytes = encodedSize;
    if (encodedSize >= buffer.length) {
        const kept = base + "-full" + originalExt;
        fs.writeFileSync(path.join(dir, kept), buffer);
        fs.rmSync(path.join(dir, fullWebp));
        written.full = rel(kept);
        fullBytes = buffer.length;
    } else {
        written.full = rel(fullWebp);
    }

    const meta = await sharp(buffer).metadata();
    // A quarter-turn in the orientation tag swaps what width and height mean
    const turned = (meta.orientation || 0) >= 5;
    const bytes = fullBytes
        + fs.statSync(path.join(ROOT, written.view)).size
        + fs.statSync(path.join(ROOT, written.thumb)).size;

    return {
        src: written.view,
        thumb: written.thumb,
        full: written.full,
        w: (turned ? meta.height : meta.width) || payload.w || 0,
        h: (turned ? meta.width : meta.height) || payload.h || 0,
        // The strip copy's real width, so the page can offer it honestly
        viewW,
        // What this upload costs the repository, so the manager can show it
        bytes
    };
}

/* Removes the copies a work owns. Only paths inside images/projects can be
   touched, and only ones no other work still points at. */
function handleDeleteImage(payload, projects) {
    const paths = [payload.src, payload.thumb, payload.full, payload.poster, payload.preview]
        .filter(Boolean);
    const stillUsed = new Set();
    for (const project of projects) {
        for (const work of project.works || []) {
            [work.src, work.thumb, work.full, work.poster, work.preview]
                .forEach((p) => p && stillUsed.add(p));
            // A gallery keeps its pictures a level down, and they are in use too
            for (const frame of work.frames || []) {
                [frame.src, frame.thumb, frame.full, frame.poster, frame.preview]
                    .forEach((p) => p && stillUsed.add(p));
            }
        }
    }

    const removed = [];
    for (const rel of new Set(paths)) {
        if (stillUsed.has(rel)) continue;
        if (!rel.startsWith("images/projects/")) continue;

        const file = path.join(ROOT, rel);
        if (!file.startsWith(IMAGES)) continue;
        if (fs.existsSync(file)) {
            fs.rmSync(file);
            removed.push(rel);
        }
    }
    return removed;
}

function serveStatic(req, res, urlPath) {
    let file = path.join(ROOT, decodeURIComponent(urlPath));
    if (!file.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.join(file, "index.html");
    }
    if (!fs.existsSync(file)) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found: " + urlPath);
        return;
    }

    res.writeHead(200, {
        "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
        // Always fresh: the whole point is to see the change you just made
        "Cache-Control": "no-store"
    });
    fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const route = url.pathname;

    try {
        if (route === "/manage" || route === "/manage/") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            res.end(fs.readFileSync(ADMIN));
            return;
        }

        if (route === "/api/projects" && req.method === "GET") {
            json(res, 200, {
                ...JSON.parse(fs.readFileSync(DATA, "utf8")),
                resize: Boolean(sharp),
                // Whether a clip can be given a small copy for the index to play
                clips: hasFfmpeg()
            });
            return;
        }

        if (route === "/api/projects" && req.method === "PUT") {
            const payload = JSON.parse((await readBody(req)).toString("utf8"));
            if (!Array.isArray(payload.projects) || !payload.projects.length) {
                throw new Error("Refusing to save an empty project list");
            }

            const slugs = payload.projects.map((p) => p.slug);
            if (slugs.some((s) => !isSlug(s))) throw new Error("A project has an unusable slug");
            if (new Set(slugs).size !== slugs.length) throw new Error("Two projects share a slug");

            fs.writeFileSync(DATA, JSON.stringify({ projects: payload.projects }, null, 2) + "\n");
            const result = await buildPages();
            console.log(`  saved - ${result.projects} pages, ${result.works} works`);
            json(res, 200, { ok: true, ...result });
            return;
        }

        if (route === "/api/upload" && req.method === "POST") {
            const payload = JSON.parse((await readBody(req)).toString("utf8"));
            json(res, 200, await handleUpload(payload));
            return;
        }

        /* Reads a folder of renders straight off the disk. Nothing travels through
           the browser, so a hundred 4K files cost no more than one, and there is
           no upload to sit and watch. Images only - a clip needs the browser to
           grab a poster frame for it. */
        if (route === "/api/import" && req.method === "POST") {
            const payload = JSON.parse((await readBody(req)).toString("utf8"));
            if (!isSlug(payload.slug)) throw new Error("Bad project slug");

            const dir = path.resolve(String(payload.dir || "").trim().replace(/^["']|["']$/g, ""));
            if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
                throw new Error("No folder at " + dir);
            }

            const names = fs.readdirSync(dir)
                .filter((name) => /\.(jpe?g|png|webp|tiff?|avif)$/i.test(name))
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

            if (!names.length) throw new Error("No images in " + dir);

            const works = [];
            for (const name of names) {
                const file = path.join(dir, name);
                if (fs.statSync(file).isDirectory()) continue;

                const out = await handleUpload({
                    slug: payload.slug,
                    name,
                    data: fs.readFileSync(file).toString("base64")
                });
                works.push({
                    type: "image",
                    src: out.src,
                    thumb: out.thumb,
                    full: out.full,
                    w: out.w,
                    h: out.h,
                    viewW: out.viewW,
                    title: name.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_"),
                    body: "",
                    bytes: out.bytes
                });
                console.log(`  imported ${name} -> ${out.w}x${out.h}`);
            }

            json(res, 200, { works });
            return;
        }

        if (route === "/api/delete-image" && req.method === "POST") {
            const payload = JSON.parse((await readBody(req)).toString("utf8"));
            const { projects } = JSON.parse(fs.readFileSync(DATA, "utf8"));
            json(res, 200, { removed: handleDeleteImage(payload, projects) });
            return;
        }

        serveStatic(req, res, route === "/" ? "/index.html" : route);
    } catch (error) {
        console.error("  ! " + error.message);
        json(res, 400, { error: error.message });
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`\n  Manager   http://127.0.0.1:${PORT}/manage`);
    console.log(`  Site      http://127.0.0.1:${PORT}/`);
    console.log(`  Images    images/projects/<slug>/${sharp ? "  (resized on upload)" : "  (stored as-is)"}`);
    console.log(`  Clips     ${hasFfmpeg() ? "a small copy is made for the index" : "no ffmpeg - the index will play the full clip"}`);
    console.log(`\n  Ctrl+C to stop.\n`);
});
