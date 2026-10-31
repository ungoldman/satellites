# Agent Guidelines

- install: `npm install`
- run: `npm start` (port 4173. `PORT` changes it. `-- --no-open` skips browser.)
- test: `npm test`, `npm run coverage`
- format: `npm run format`

Node 22.12+. Do not alter version. Push to `main` deploys https://ungoldman.com/satellites via `pages.yml`.

## Conventions

- Atomic conventional commits, `<topic>: <action>`, 50 chars max. Body only when needed. Wrap at 72.
- No AI attribution in commits.
- Breaking changes discouraged. They need `BREAKING CHANGE:` footer.
- Plain JS modules. No build. Relative paths, so page drops into any static site.
- On ungoldman.com the page joins the site's router, see the page contract in `ungoldman.github.io/AGENTS.md`. `/router.js` and `/router/controls.js` are absent on the dev server and that is fine. `mount()` in `src/app.js` runs again in the same document, and what it returns undoes everything outside the page's own nodes.
- No stylesheets or scripts from elsewhere. The page carries its own tokens. Data and images come from CelesTrak, NOAA STAR, NICT, CIRA SLIDER, and NASA Worldview at runtime.
- Few comments, kept trim.
- 100% coverage on `src/orbit.js`, `src/view.js`, `src/fleet.js`, and `src/server.js`. `src/app.js` is checked in browser.
- `satellite.js` is a devDependency only. Tests hold `src/orbit.js` to within 60 km of its SGP4 over three days, against the elements in `test/fixtures/gp.json`.

## Layout

- `src/index.html`: markup, styles, theme tokens, the card, the ? panel with explainer and credits.
- `src/og.png`: share image, a 1200x630 screenshot with the header and readout hidden.
- `src/orbit.js`: OMM elements, two-body plus J2 propagation, sidereal time, geodetic, Sun direction, scales. No DOM.
- `src/view.js`: quaternion camera, projection, ray-sphere hit and occlusion, fling, key map. No DOM.
- `src/fleet.js`: the satellites shown, CelesTrak groups, image and link builders per source, slot guessing for full disks. No DOM.
- `src/coast.js`: Natural Earth 1:110m land rings, generated once. Not linted. The globe fills them into a lat, lon mask and strokes them as coastlines.
- `src/app.js`: canvas, lit globe, coastlines, satellites and labels, card, steering from keys and touch, pinch, wheel, theme, element cache. Keys match `event.code`.
- `src/server.js`, `src/start.js`: dev server.
