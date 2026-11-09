WHITE TUSKER — PRODUCT & TANGIBLE EXPERIENCE ROOM

Shareable viewer: https://wt-retail-experience.lunarhill2.chatgpt.site

ROOM
50 ft wide × 30 ft deep × 14 ft high; metres, Y up. The front feature wall is the 50 ft wall. The metallic red / glossy graphite shell, warm cove and circular ceiling diffuser match the previous room.

LEFT EXPERIENCE
Six 3D Nike-branded concept shoe colorways in three columns × two rows of gold circular niches. Each shoe is a deliberately enlarged 450 mm display study, not an exact retail SKU. The reference-inspired 55-inch 16:9 kiosk is directly in front; its active screen is inclined exactly 50 degrees above horizontal.

RIGHT EXPERIENCE
An accurately sized 85-inch 16:9 wall screen faces a horizontal multi-touch table. As table size was unspecified, a 75-inch 16:9 active surface was selected, at 940 mm above the floor. Three physical tangible pucks sit on the glass. The displayed interfaces are illustrative; the GLB contains static geometry and materials, not touch or object-recognition software.

FILES
WT_Retail_Experience_Room.glb — complete self-contained GLB with embedded textures.
WT_Retail_Experience_Room_Cutaway.glb — the same model with ceiling, hanging lights and rear shell hidden for orbit inspection.
*_Interior.png / *_Overview.png / *_Products.png / *_Table.png — ray-traced lighting-study renders of the model geometry.
maps/ — baked illumination, AO, architectural micro-normal/roughness and display images.
Dimensions_and_Materials.json — dimensional specification and source attribution.
Geometry_Validation.json — measured geometry checks.
GLB_Validation.json — Khronos glTF validation results.
Bake_Report.json — bake sampling and export statistics.
source/ — portable scene builder, bake/export and preview scripts, with source assets.

LIGHTING & MATERIALS
Direct diffuse light, contact AO and two sampled diffuse bounce iterations are embedded as baked illumination. The GLB retains metallic/roughness and clearcoat material properties for moving reflections. It is not a full offline path-traced GI bake. A GLB cannot carry a universal renderer environment: use environment illumination in your own viewer. The supplied web viewer captures the actual room for reflections and adds a softened planar floor reflection. This preserves the rich metallic response as you orbit. Preview renders use a CPU GGX reflection study; they can differ from the live viewer.

REBUILD
Install source/requirements.txt in Python 3.11+, then run source/build_room.py, source/bake_export.py and source/compact_glb.py. The supplied UI images need no regeneration; optional source/make_ui.py uses DejaVu Sans fonts. Run source/render_room.py Interior, Overview, Products or Table to generate preview renders. Source pickles belong to this supplied package and should only be opened as trusted project inputs.

VALIDATION
The geometry, required screen diagonals/aspects, 50-degree kiosk tilt, shoe count, niche clearances and GLB format were checked. Live browser interaction QA was unavailable in this environment.

ATTRIBUTION
See CREDITS.txt for the CC BY 4.0 shoe geometry and adaptation details.
