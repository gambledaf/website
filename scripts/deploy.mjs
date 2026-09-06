/*
 * Publishes the site to the gh-pages branch.
 *
 * The gh-pages CLI takes a single glob and defaults to "**\/*", which sweeps up
 * node_modules along with the site - 150MB+ of build tooling on a page that only
 * needs the html, css, js and assets. The Node API accepts an array, so the
 * excludes live here instead.
 */

import ghpages from "gh-pages";

const src = [
    "**/*",
    "!node_modules/**",   // build tooling, not site content
    "!tools/**",          // the manager only ever runs on your own machine
    "!.claude/**"
];

ghpages.publish(".", { src, message: "Update site" }, (error) => {
    if (error) {
        console.error("deploy failed: " + error.message);
        process.exitCode = 1;
        return;
    }
    console.log("published to gh-pages");
});
