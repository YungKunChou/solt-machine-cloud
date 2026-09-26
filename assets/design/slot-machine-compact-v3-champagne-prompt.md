# 機台 v3：B1 香檳金陰刻

使用內建 image_gen 編輯原始 slot-machine-compact-v2.png，並以使用者選定的 B1 圖作為刻字風格參考。
產出完整 1448 × 1086 RGBA 機台圖，China Motor Company 直接存在木質底座像素中。
網頁的機身、拉桿裁切與轉軸貼圖皆共用 slot-machine-compact-v3-champagne.png，不再使用獨立刻字圖片或刻字定位遮罩。
原始 v2 圖仍保留。此圖為生成式編輯，不宣稱木板以外逐像素相同；拉桿定位與動畫程式維持原設定。
依專案偏好，網頁視覺效果由使用者人工確認。

## 完整生成提示詞

Use case: precise-object-edit. Image 1 is the EDIT TARGET, the complete transparent vintage slot-machine sprite (1448 by 1086). Image 2 is a STYLE REFERENCE ONLY for the approved B1 champagne-gold intaglio lettering. Edit the actual FULL MACHINE in image 1: engrave the exact words "China Motor Company" centered in the dark walnut strip on its BOTTOM PLINTH. Render the letters permanently as part of this full machine raster. Keep the full machine canvas and source geometry EXACTLY aligned with image 1, same 4:3 framing, ideally output 1448x1086. Preserve the transparent alpha background, all exterior contours, the entire top beacon, ornaments, two red ball levers and their shafts and sockets, feet, metal bezel, lighting, and the completely BLANK ivory central display. Do not add reel values or a divider. The only changed pixels should be within the wood panel approximately x=216..1232 y=916..976 in source coordinates. Exact lettering: "China Motor Company", Georgia Bold style serif, matching reference image 2's refined B1, soft matte champagne gold #D8C28F on the floor of shallow carved cavities. Text spans approximately 50 percent of wood-panel width, centered at x=724 y=945, actual glyph height about 27 source pixels. Upper inner edges have moderate crisp dark wood shadows, outer highlights subdued. Clearly incised into wood, NOT a raised metal logo, and not overly deep. Leave original wood grain visible around lettering. DO NOT paste any rectangular crop or plaque over the base. NO layout changes, no camera changes, no machine scaling or repositioning, no redesign, no border, no background, no floor shadow outside the machine. Return a single FULL MACHINE image with real transparent background.
