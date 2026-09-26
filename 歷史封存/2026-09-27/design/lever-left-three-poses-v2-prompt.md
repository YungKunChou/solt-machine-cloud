# 左側拉桿球頭透視調整 v2

使用內建 ImageGen，沿用使用者選定的第二版造型（lever-left-three-poses-v1.png），調整球頭隨靠近玩家而逐步放大的透視感。
最終成果：lever-left-three-poses-v2.png。
預覽：lever-left-poses-preview.html。尚未修改遊戲動畫。

球頭直徑提示目標為直立 100%、半拉 112%、拉到底約 125%；屬於概念圖目標，非精確測量或實體相機標定值。
生成過程調整了放大幅度，並以原始案二為主要來源，保留朝前下方轉動的根部接合。

## 透視調整提示

Use case: precise-object-edit. Edit target: the provided approved second-design three-panel image of a LEFT slot-machine lever pulling toward the viewer. Deliver ONE updated three-panel comparison image with identical composition, dimensions, materials and camera.
User request: preserve this design and make the glossy red ball visibly and progressively larger as the lever is pulled toward the viewer, for convincing perspective.
Only modify the red ball heads and their immediate brass neck connections as necessary for consistent perspective. Keep all stationary metal bases, rotating root positions, cabinet strips, rod pose directions and panel spacing unchanged. Do NOT revert to sideways swinging. The rods should remain nearly vertical in screen space, foreshortening in depth as in reference.
LEFT PANEL / upright: absolutely preserve original ball size (baseline 100%), position, deep ruby red color, polished finish and original sphere shape.
MIDDLE PANEL / half pull: ball apparent DIAMETER approximately 112% of left-panel baseline (not 112% of its current already-larger size). Make this a subtle but readable increase from upright.
RIGHT PANEL / full pull: ball apparent DIAMETER approximately 124% of left-panel baseline, making the increase clearly larger than middle but still mechanically plausible, not cartoonishly inflated. Use the same physical ball implied at a nearer depth. Preserve contact with its brass neck. Anchor ball to its neck while enlarging around the sphere's center with small center adjustment as needed: no floating gap, no detached collar, no rod passing through ball.
Keep spheres round, no oval stretching. Maintain same characteristic softbox reflections adjusted coherently over the larger spherical surface. Ball-near brass collar may grow modestly with depth, with smooth transition toward shaft; do not enlarge the stationary root or whole base. All three stages remain the same lever with the same physical ball size viewed at different distances, not three differently manufactured handles.
Preserve the root socket progression from top of cylinder to front-lower face. Preserve fixed pivot center alignment. Warm white background, no text, no labels, no arrows, no watermarks. Faithful revision, not redesign. Three panels are a single visual proposal sheet.

## 幅度修正提示

Precise refinement of the supplied three-panel image. Preserve left panel entirely, preserve all bases, shafts, cabinet edges, root sockets and layout entirely. ONLY reduce red sphere sizes in middle and right panels because the prior edit made the perspective enlargement too strong.
Image is 1536x1024. LEFT red sphere is about 170 pixels wide; leave it unchanged.
MIDDLE red sphere is currently about 210 pixels wide. REDUCE its visible red sphere diameter to about 190 pixels (90% of its CURRENT size). Keep its bottom attachment point at existing neck around x715 y469. Keep it perfectly round, deep red glossy identical design, shift center downward slightly as necessary to maintain bottom contact.
RIGHT red sphere is currently about 255 pixels wide. REDUCE its visible red sphere diameter to about 212 pixels (83% of its CURRENT size). Keep its bottom attachment at existing neck around x1248 y615. Keep it perfectly round and shift center down toward the neck as necessary to maintain bottom contact.
Final red-ball diameter ratio left:middle:right should be close to 1:1.12:1.25, NOT 1:1.25:1.5. Reconstruct white background wherever oversized sphere has been removed; preserve cabinet and rod surfaces faithfully. Brass cup directly under ball should match slightly reduced spheres without changing shaft or base scale. Same connected physical mechanism, only subtle plausible perspective size gradient. Do NOT enlarge any ball further. No text, arrows, labels or other changes.

## 最終提示

Precise local edit using TWO input images. IMAGE 1 is the approved mechanism and absolute edit target. IMAGE 2 is ONLY a reference for moderate red-ball size progression; do NOT copy its altered mechanism.
Return the three-panel sheet of IMAGE 1 with all its original pixels/geometry/poses preserved as closely as possible EXCEPT middle/right red spheres and their immediate ball-to-neck collars.
CRITICAL preserve IMAGE 1 right-panel ROOT SOCKET at lower FRONT of silver cylinder, centered approximately x1268 y647. Preserve its original short brass rod, front-facing circular root ring, shadows and stationary bearing. Do not move root back to TOP of cylinder, do not change rod pose or cabinet. The whole reason for choosing IMAGE 1 is its down-rotated socket.
At 1536x1024 output:
- LEFT ball stays exactly original ~170px wide at original position. Whole left panel unchanged.
- MIDDLE ball diameter ~190px, center approximately x715 y383, bottom about y478, connected to original neck. This is a slight increase over original. Keep root and rod unchanged.
- RIGHT ball diameter ~212px, center approximately x1252 y538, bottom about y644. This is only a small increase over its original ~195px size. This sphere remains LOW directly in front of the base, do not lift it to IMAGE 2 higher position. Preserve original down-rotated root at y647 with original depth overlap and original shaft connection.
Spheres round glossy deep ruby, matching current reflections. No extra zoom of other parts. Baseline size ratio approximately 1 : 1.12 : 1.25. IMAGE 1 mechanism is mandatory; IMAGE 2 sphere size progression is only supporting reference. No labels or text. Do not lift any socket, do not rebuild metal base, do not change cabinet artwork.
