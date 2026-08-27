# SOL 1 · ACIDALIA — Cybertruck on Mars

Cinematic browser Tesla Cybertruck driving simulation on Acidalia Planitia.
Stack: Vite and Three.js. Mars gravity, explorable highlands, a crater,
a canyon, and a Starship landing site.

## Run

From this folder: install dependencies, then start the dev server on port 5173.

- Dev URL: http://localhost:5173
- Scripts: `dev`, `build`, `preview` (see package.json)

## Controls

- WASD or arrows: drive and steer
- Space: brake
- Shift: boost
- Mouse drag: look
- C: cycle chase / hood / orbit camera
- R: reset to the spawn plateau

## World

Opens on Mars immediately: butterscotch sky, small hard sun, long warm
shadows, rust-ochre regolith. Drive east-northeast to the stainless Starship
and NASA habitat camp. Northwest is a driveable crater. A shallow outflow
canyon cuts east. Dune ripples thicken toward the northeast.

Physics use 3.71 m/s2 (about 0.38 g). Four-wheel suspension rays hit the
same heightfield as the mesh. Slight dust slip under boost. Heavy, planted,
not arcade-floaty.

## Vehicle

Driven mesh is a real low-poly Tesla Cybertruck GLB (kulonee), auto-fitted to
~5.7 × 2.2 × 1.8 m with stainless / near-black glass / rubber materials.
Fused GLB wheel pairs are hidden; procedural aero wheels sit in the wells
and take spin + steer. Starship remains a procedural mesh.

## Asset licenses

- public/textures/mars_viking.jpg — NASA/USGS Viking MDIM PIA00407, public domain
- public/textures/mars_dunes.jpg — NASA/JPL/UArizona HiRISE PIA13728, public domain
- public/models/habitat-a.glb and habitat-b.glb — NASA Habitat Demonstration Unit
  (science.nasa.gov/3d-resources/habitat-demonstration-unit/)
- public/models/cybertruck.glb — "Low Poly Tesla Cybertruck" by kulonee
  (Sketchfab / get3dmodels). Free Standard / Sketchfab Standard license.
  Source: https://www.get3dmodels.com/vehicles/cybertruck-lowpoly/
  Sketchfab: https://sketchfab.com/3d-models/low-poly-tesla-cybertruck-64b4af3ab92543d297992ac4c2f8ed96
  ~14.9k verts / 9.3k tris. No textures shipped; materials forced in src/truck.js.
- Starship mesh — original procedural model in src/world.js

Tesla, Cybertruck, and Starship are trademarks of their owners.
This is an unofficial fan simulation.
