# Agent Guidelines

- install: `npm install`
- run: `npm start` (port 4173. `PORT` changes it. `-- --no-open` skips browser.)
- test: `npm test`, `npm run coverage`
- format: `npm run format`
- data for the dev server: `npm run elements` writes `src/gp.json`, `npm run bake` writes `src/terrain-2.webp` and `src/terrain-3.webp` and needs `cwebp` (`brew install webp`). All three are gitignored.

Node 22.12+. Do not alter version. Push to `main` deploys https://ungoldman.com/satellites via `pages.yml`.

## Conventions

- Atomic conventional commits, `<topic>: <action>`, 50 chars max. Body only when needed. Wrap at 72.
- No AI attribution in commits.
- Breaking changes discouraged. They need `BREAKING CHANGE:` footer.
- Plain JS modules. No build. Relative paths, so page drops into any static site.
- On ungoldman.com the page joins the site's router, see the page contract in `ungoldman.github.io/AGENTS.md`. `/router.js` and `/router/controls.js` are absent on the dev server and that is fine. `mount()` in `src/app.js` runs again in the same document, and what it returns undoes everything outside the page's own nodes.
- No stylesheets or scripts from elsewhere. The page carries its own tokens. Data and images come from CelesTrak, the Terrain Tiles on AWS Open Data, NOAA STAR, NICT, CIRA SLIDER, and NASA Worldview. Elements and terrain are fetched by the Pages workflow and published beside the page, and the rest load at runtime.
- The globe is WebGL2. Where it is missing, `src/app.js` falls back to a plain canvas globe from the land mask.
- Few comments, kept trim.
- 100% coverage on `src/orbit.js`, `src/view.js`, `src/fleet.js`, `src/time.js`, `src/terrain.js`, `src/globe.js`, and `src/server.js`. `src/terrain.js` takes its network and canvas as tools, and `test/globe.test.js` drives `src/globe.js` with a stand-in WebGL context, so both run in Node. `src/app.js` is checked in browser.
- `satellite.js` is a devDependency only. Tests hold `src/orbit.js` to within 60 km of its SGP4 over three days, against the elements in `test/fixtures/gp.json`.

## Navigation

The camera is a turntable with north up. Every input that moves the view goes through `steer` in `src/view.js`, which rebuilds the view from the center's latitude and longitude with `facing`. The keys are the model: `W` `A` `S` `D` move the center north, west, south, and east at a steady rate of longitude, and the center stops at 89°.

- Drag is grab-to-pan. `press.grab` holds the ground under the pointer at `pointerdown`, and `pin` in `src/app.js` steers until that ground sits under the pointer again. A change in longitude moves every point by the same amount, but a change in latitude is exact only on the center's meridian, so `pin` runs up to four rounds. Off the globe the drag falls back to `grip()` degrees per pixel.
- Wheel, pinch, `=`, and `-` zoom through `zoomAt`, which pins the ground under the pointer the same way.
- A fling carries on as degrees north and east per frame through `steer`.
- `R` swings to `homeView`, 0° and 20°N. `G` and picking a satellite swing to a `facing` view too, so every swing ends north up.

Two setups came before this one and were dropped on 2026-11-04:

- Trackball (arcball), the original. Drag turned the view about the screen axes with `turn`, and zoom at the pointer used `between`. Both rolled the view, and the next key press snapped the roll out, so the view jumped.
- Turntable at a fixed rate per pixel. North stayed up, but near the poles the ground slid slower than the pointer.

Near a pole `pin` can't hold the grabbed ground, because the 89° stop blocks the move it needs. Over a drag of 40 pointer events the ground stays within 0.01° of the pointer up to 75° and slips by several degrees at 85°.

Keep free rotations of `orientation` out of input handling. The one `multiply` on it is the Earth's turn in `frame`, which spins about the axis and leaves north up.

## Layout

- `src/index.html`: markup, styles, theme and style tokens (colour and mono, each light and dark), the satellite list, the card, the time bar, the ? panel with explainer and credits.
- `src/og.png`: share image, a 1200x630 screenshot with the header and readout hidden.
- `src/orbit.js`: OMM elements, two-body plus J2 propagation, sidereal time, geodetic, Sun direction, scales, the ground a satellite sees, sunlight, and the timing of a daylight pass. No DOM.
- `src/view.js`: quaternion camera, projection, ray-sphere hit and occlusion, fling, key map, the view kept with the Earth, zoom toward a point, drag and contour scale with zoom, the latitude ring. No DOM.
- `src/fleet.js`: the satellites shown, CelesTrak groups, image and link builders per source, slot guessing for full disks with the time of each. No DOM.
- `src/time.js`: the clock in words and the time bar's week either side of now. No DOM.
- `src/terrain.js`: Terrarium heights decoded into one Mercator square of the world. Loads the stitched `terrain-<zoom>.webp` beside it in one request and falls back to the 64 or 16 tiles on AWS when that file is missing. No DOM of its own. `src/app.js` loads zoom 2 first, about 1 MB, and zoom 3, about 3.8 MB, only once the globe passes `DETAIL_PX` device pixels per Earth radius, never on a phone.
- `src/bake.js`: stitches the tiles into `terrain-2.webp` and `terrain-3.webp`, reading them with its own PNG reader on `node:zlib` and encoding with `cwebp -lossless -exact`, which keeps every height. The Pages workflow carries the published copies forward and bakes only a missing one, since the heights do not change. Not covered by tests, like `src/elements.js`.
- `src/globe.js`: the WebGL2 globe, ray-cast per pixel, its colour and mono styles in one shader, with height, contour, grid, and terminator.
- `src/coast.js`: Natural Earth 1:110m land rings, generated once. Not linted. The globe fills them into a lat, lon mask and strokes them as coastlines.
- `src/app.js`: wires it together. Overlay canvas with satellites, trails, labels, belt dial, latitude ring, view cone, and leader line, the card and list, the time bar, steering from keys, touch, pinch, and wheel, style and theme, saved view, location, element cache. Keys match `event.code`.
- `src/server.js`, `src/start.js`: dev server.
