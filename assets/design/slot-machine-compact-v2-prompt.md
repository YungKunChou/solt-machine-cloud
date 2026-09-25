# 精簡版機台視覺提案 v2

使用內建 image_gen，以 slot-machine-compact-v1.png 為編輯來源。
設計目標：中央視窗加高 20%，保留寬度、機頂、底座和金屬質感，整機自然增高。生成圖是視覺提案，非精密尺寸加工；20% 為提示詞指定目標，未宣稱像素精確符合。
已套用到 slot-machine.html；machine.css 以同一張圖片分層顯示機身與可動拉桿，原始 PNG 不變。

## 完整生成提示詞

Use case: precise-object-edit.
Input image 1 is the EDIT TARGET, the approved compact photorealistic slot machine. Produce one second-version image, not a comparison or collage.
Make exactly this proportion change: increase the HEIGHT OF THE EMPTY CENTRAL IVORY DISPLAY by 20%, keeping its width exactly unchanged. Reference display is roughly 950 units wide by 430 units high; target is roughly 950 wide by 516 high, a width-to-height ratio approximately 1.84:1. Add the extra vertical space to the middle of the display and corresponding straight vertical cabinet side rails. Shift the complete lower frame and base downward to accommodate the taller display. The whole cabinet naturally becomes taller by that added amount.
Preserve all other approved visual choices: exact overall machine width, straight-on symmetrical camera, realistic aged brass and silver frame, dark walnut details, warm golden edge lights, reflections, red ball-topped double levers, and blank ivory display.
CRITICAL invariants: top crown, circular top ornament and beacon retain their original heights, widths, shapes and proportions. Bottom wood-and-metal plinth and feet retain their original heights, widths, shapes and proportions, only move downward. Metal border thickness stays unchanged. Do not vertically stretch the whole image, beacon, balls, base or ornaments. Preserve lever shape and length, translate the lever assemblies down slightly if needed to maintain alignment with the expanded window. Do not expand cabinet width or add decorations.
Expand canvas height as needed to preserve source scale and small safe margins with the entire machine visible. Keep genuinely transparent alpha outside the machine, with clean edges; no background scene, floor, or painted checkerboard.
Display must remain completely blank with subtle warm ivory shading: no text, numbers, symbols, reel graphics, divider, logo, watermark, labels or UI overlays.
Result should look like the SAME approved machine, with a clearly taller central reading window and naturally taller body, not a redesigned machine.
