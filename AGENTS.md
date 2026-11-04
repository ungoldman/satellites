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
- No stylesheets or scripts from elsewhere. The page carries its own tokens. Data and images come from CelesTrak, the Terrain Tiles on AWS Open Data, NOAA STAR, NICT, CIRA SLIDER, and NASA Worldview at runtime.
- The globe is WebGL2. Where it is missing, `src/app.js` falls back to a plain canvas globe from the land mask.
- Few comments, kept trim.
- 100% coverage on `src/orbit.js`, `src/view.js`, `src/fleet.js`, `src/time.js`, `src/terrain.js`, `src/globe.js`, and `src/server.js`. `src/terrain.js` takes its network and canvas as tools, and `test/globe.test.js` drives `src/globe.js` with a stand-in WebGL context, so both run in Node. `src/app.js` is checked in browser.
- `satellite.js` is a devDependency only. Tests hold `src/orbit.js` to within 60 km of its SGP4 over three days, against the elements in `test/fixtures/gp.json`.

## Layout

- `src/index.html`: markup, styles, theme and style tokens (colour and mono, each light and dark), the satellite list, the card, the time bar, the ? panel with explainer and credits.
- `src/og.png`: share image, a 1200x630 screenshot with the header and readout hidden.
- `src/orbit.js`: OMM elements, two-body plus J2 propagation, sidereal time, geodetic, Sun direction, scales, the ground a satellite sees, sunlight, and the timing of a daylight pass. No DOM.
- `src/view.js`: quaternion camera, projection, ray-sphere hit and occlusion, fling, key map, the view kept with the Earth, zoom toward a point, drag and contour scale with zoom, the latitude ring. No DOM.
- `src/fleet.js`: the satellites shown, CelesTrak groups, image and link builders per source, slot guessing for full disks with the time of each. No DOM.
- `src/time.js`: the clock in words and the time bar's week either side of now. No DOM.
- `src/terrain.js`: Terrarium height tiles decoded into one Mercator square of the world, zoom 3, or zoom 2 on phones. No DOM of its own.
- `src/globe.js`: the WebGL2 globe, ray-cast per pixel, its colour and mono styles in one shader, with height, contour, grid, and terminator.
- `src/coast.js`: Natural Earth 1:110m land rings, generated once. Not linted. The globe fills them into a lat, lon mask and strokes them as coastlines.
- `src/app.js`: wires it together. Overlay canvas with satellites, trails, labels, belt dial, latitude ring, view cone, and leader line, the card and list, the time bar, steering from keys, touch, pinch, and wheel, style and theme, saved view, location, element cache. Keys match `event.code`.
- `src/server.js`, `src/start.js`: dev server.
