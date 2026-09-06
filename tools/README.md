# Managing projects

`data/projects.json` is the source of truth for every project on the site.
Everything else about a project is generated from it:

```
data/projects.json
        |
        |  node tools/build-pages.mjs
        v
filepage/<slug>.html      the project pages
js/files.js               the tape list the index page reads
```

**Do not hand-edit `filepage/*.html` or `js/files.js`** — they are overwritten on
every build. Edit the JSON, or use the manager.

## The manager

```
npm run manage
```

Opens two things on your machine only (it binds to 127.0.0.1 and has no login,
because nothing else can reach it):

- `http://127.0.0.1:4321/manage` — the editor
- `http://127.0.0.1:4321/` — the site, served over http so you can preview it

In the editor you can:

- **Reorder projects** — drag them in the left column. The order is the tape
  order on the index page, and it also decides each page's NEXT_FILE link.
- **Add a project** — `+ NEW`. Set its slug before saving; that becomes the page
  filename, and renaming it later leaves the old page behind until you rebuild.
- **Upload images** — drop files anywhere on the works grid. Several at once is
  fine.
- **Reorder works** — drag a card in the grid, or press `ARRANGE` to do it on the
  real page. Arrange opens the built project page inside the manager: drag one
  work onto another to move it there, and the layout redraws exactly as it will
  on the site. Nothing is written from in there - the moves come back here, and
  `SAVE + BUILD` keeps them. Save before opening it, since it shows the built
  page rather than unsaved edits.
- **Pick a layout** — `LAYOUT` on each project:
  - `STRIP` slides the works sideways, two rows deep, through a window that
    stays put. Good for scanning a lot of work quickly.
  - `FREE` puts nothing in charge: open `ARRANGE` and drag each work where you
    want it, dragging its bottom-right corner to resize. Positions are kept as
    fractions of the canvas width, so the arrangement holds its proportions at
    any screen size - on a phone the whole composition scales down rather than
    rearranging itself. `SNAP` in the arrange bar lines works up with each
    other's edges and centres; hold Alt to ignore it for one drag.
  - `COLUMN` runs them down the page instead, one at a time, each with its notes
    printed underneath. Good when a piece wants reading rather than scanning.
    Works are capped to the height of the window so none takes several screens
    to scroll past. In `ARRANGE` you can drag one work onto another to reorder
    them, and drag a work's bottom-right corner to set how wide it sits - its
    place in the column is decided by the order, so only the width is free.
- **Put two works side by side** — in the COLUMN layout, tick `SIDE BY SIDE` on
  a work. It shares a line with the work directly before or after it, if that one
  is marked too. They have to be neighbours in the running order: a mark on its
  own only makes that work narrower, and the manager says so on the card.
- **Edit titles, notes and specs** — typed straight into the cards and fields.
- **Add a video** — `+ VIDEO`, then paste any YouTube link: the address bar,
  the share button, or a Short. Vimeo links work too, though only YouTube gives
  the index rail a thumbnail to show.

`SAVE + BUILD` (or Ctrl+S) writes the JSON and regenerates the pages.

## Publishing

Commit and push to `main`. `.github/workflows/static.yml` deploys the repository
to Pages on every push, so that is all it takes.

Note that the workflow uploads the repo as it stands and does not run a build, so
the generated pages have to be committed alongside the JSON. Saving in the
manager does that for you. Editing `data/projects.json` by hand and pushing
without running `npm run build:pages` first will leave the site unchanged.

(`npm run deploy` pushes to the `gh-pages` branch, which this site does not
serve. It is left in place but it is not the way to publish.)

## What happens to an uploaded image

Each upload is stored three times under `images/projects/<slug>/`:

| copy    | longest edge | used by            |
| ------- | ------------ | ------------------ |
| `thumb` | 400px        | the index rail     |
| `view`  | 1600px       | the strip          |
| `full`  | 2800px       | the lightbox       |

They are WebP, unless re-encoding came out larger than the file you gave it — an
already-compressed JPEG often does — in which case your original is kept for that
size instead. Images live in the repo, so the smaller of the two always wins.

The pixel dimensions are recorded in the JSON and written onto the `<img>` tag.
The strip reads them to lay itself out correctly on the first frame, instead of
guessing 16:9 and re-measuring once each picture arrives.

Resizing needs `sharp` (already a devDependency). Without it the manager still
works, but stores one copy at the original size and says so in its status line.

## Deleting

Removing a work from a project deletes its image files too, but only the ones no
other project still points at. Deleting a *project* leaves its images on disk —
remove `images/projects/<slug>/` by hand if you want them gone.
