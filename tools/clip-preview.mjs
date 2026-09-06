/* A small copy of a clip, for the index to play when a tape is hovered.
 *
 * The clip itself is the finished thing: whatever resolution and length it was
 * made at, which for a render is easily thousands of pixels and tens of
 * megabytes. The index shows it in a frame a couple of hundred pixels tall for
 * as long as a pointer rests on a tape, so serving the finished file there
 * means a visitor downloading a hundred times what they can actually see.
 *
 * This is the same bargain the pictures already make - the manager keeps a
 * thumbnail, a view copy and the full one - applied to footage.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Tall enough to stay sharp on a high-density screen at the size it is shown
const PREVIEW_HEIGHT = 360;
// Long enough to read as motion, short enough that nobody waits for it
const PREVIEW_SECONDS = 6;

/* Looked for once. Without it the site still works - the index just plays the
   finished clip, as it did before there was a smaller one to play. */
let available = null;

export function hasFfmpeg() {
    if (available === null) {
        const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
        available = !probe.error && probe.status === 0;
    }
    return available;
}

export const previewPathFor = (file) =>
    path.join(path.dirname(file), path.basename(file, path.extname(file)) + "-preview.mp4");

/* Returns the path written, or "" where there is no ffmpeg to write it with.
   Never throws: a project whose preview could not be made is a project whose
   index plays the full clip, which is worse but not broken. */
export function makeClipPreview(file) {
    if (!hasFfmpeg() || !fs.existsSync(file)) return "";

    const out = previewPathFor(file);
    const done = spawnSync("ffmpeg", [
        "-y",
        "-i", file,
        "-t", String(PREVIEW_SECONDS),
        // Nothing here is ever heard: the strip plays silent
        "-an",
        // Down to the height it is shown at, never up, and always an even width
        "-vf", `scale=-2:'min(${PREVIEW_HEIGHT},ih)'`,
        "-c:v", "libx264",
        "-crf", "30",
        "-preset", "veryfast",
        // So it can start playing before the whole file has arrived
        "-movflags", "+faststart",
        out
    ], { stdio: "ignore" });

    if (done.status !== 0 || !fs.existsSync(out)) return "";
    return out;
}
