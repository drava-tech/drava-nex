WHITE TUSKER — 40 × 30 DUAL-SCREEN ROOM

New room created for DC. Dimensions are 40 ft wide × 30 ft deep × 14 ft high
(12.192 × 9.144 × 4.2672 m). Units: metres; vertical axis: Y.
The height is to the structural ceiling; the decorative ceiling inset and
lighting fixtures sit below this level. Rear entrance: 8 ft wide × 9 ft high.

FRONT WALL
Two separate landscape screens, each 16 ft × 9 ft, exactly 16:9.
Active screens have a 3 ft central gap and 2.5 ft outer margins.
Active lower edge: 2 ft above the floor; upper edge: 11 ft.
White Tusker lettering is centred between the screens.
The active display meshes are named Screen_Front_Left and Screen_Front_Right.
Their UVs run 0–1 for replacement images or video in your chosen player.

FINISH AND LIGHTING
Retains the preceding rooms' metallic red and graphite material values,
micro-normal and roughness textures, clearcoat, glossy graphite flooring,
rounded warm perimeter cove, and 20 ft circular ceiling diffuser.
Direct illumination, ambient occlusion and two diffuse light bounces are baked.
Metallic PBR and clearcoat retain view-dependent highlights. The GLB embeds
all textures. Metallic reflections depend on the host viewer's environment;
the included web viewer adds room-based environment and floor reflections.
The PNGs are lighting-study renders of the model geometry. They can differ
slightly from the interactive web rendering.

FILES
WT_Room_40x30_Dual_Screens.glb — complete room, 2.09 MB.
WT_Room_40x30_Dual_Screens_Cutaway.glb — ceiling and rear wall hidden.
Interior and Overview PNGs — rendered views of the room.
maps/ — separate bake, micro-normal and roughness textures.
Dimensions_and_Materials.json — measured design specification.
Geometry_Validation.json, GLB_Validation.json — checks and validator reports.
Bake_Report.json — bake sampling and timing information.
source/ — reproducible model, bake/export and preview scripts with input assets.

SHAREABLE VIEWER
https://wt-dual-screen-room.lunarhill2.chatgpt.site
Orbit, pan and zoom; Interior, Overview and Top cameras; Shell and Edges toggles;
GLB downloads and rendered previews. All viewer assets are locally bundled.

VALIDATION
Measured room dimensions, screen dimensions, spacing and normal vectors passed.
Both exports passed the Khronos glTF validator with 0 errors and 0 warnings.
Browser interaction testing was unavailable in this environment.

REBUILD
Use Python 3 with source/requirements.txt installed, then run:
  python source/build_room.py
  python source/bake_export.py
  python source/render_room.py Interior
  python source/render_room.py Overview
On Linux, OPENBLAS_NUM_THREADS=1 and OMP_NUM_THREADS=2 improve this pipeline's
CPU scheduling. The scripts regenerate GLBs, maps and previews in this folder.
