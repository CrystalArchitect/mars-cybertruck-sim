# STATUS

## How to run

Project path: /workspace/mars-cybertruck-sim

Dev server: Vite port 5173. Do not start a second one.
Scripts: dev, build, preview.

## v5 — real Cybertruck GLB

The driven vehicle is `public/models/cybertruck.glb` (kulonee, Low Poly Tesla
Cybertruck, Sketchfab Standard / get3dmodels Free Standard). GLTFLoader parses
the GLB as an ArrayBuffer. Sketchfab +Z nose is rotated +90° Y onto drive +X
(`fwd = (cos yaw, 0, sin yaw)`). Physics API unchanged.

### Fit (runtime)
- Raw loaded size: 2.55 × 2.11 × 6.53 m
- Scale: 0.873
- After fit bbox: X 5.70 m (length), Y 1.84 m (height), Z 2.22 m (width)
- min (-2.85, -0.46, -1.11) max (2.85, 1.38, 1.11)
- Wheel offsets: front x=1.96 z=±0.87, rear x=-1.78 z=±0.90

### Materials (GLB has no textures)
- Body steel: MeshPhysical 0xd4d8e0, metalness 0.95, roughness 0.20, envMapIntensity 2.05, Mars cubemap
- Glass: near-black MeshPhysical, opacity 0.88
- Tires: black rubber 0x111111
- Wells / bumper / grid: dark plastic
- Lights: emissive front / rear / side
- GLB tire+rim meshes are fused L+R pairs — hidden. Procedural stainless aero wheels sit in the measured wells (spin + steer). No double wheels. Old wedge not in the graph.

### Screenshots
/workspace/shots/v5_chase.png
/workspace/shots/v5_hood.png
/workspace/shots/v5_side.png

### Remaining
9.3k-tri low-poly (body is only ~764 verts). Rear 3/4 still reads slabby; side/front 3/4 shows the rake, vault, light bar, and wells. No factory aero-cover texture. No audio.

## Build
Production build succeeds. Vite on 5173 hot-reloads.
