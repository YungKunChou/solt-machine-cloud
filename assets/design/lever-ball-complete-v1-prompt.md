# 球頭下緣遮擋補片

使用內建 ImageGen，參考 slot-machine-compact-v2.png 的紅色球頭。
輸出 lever-ball-complete-v1.png：1254 × 1254，透明背景，完整球體，不含金屬頸環。
以 alpha > 128 的球體邊界 x=101..1153、y=98..1140 對齊原素材 110px 球頭。
執行時以完整球體作為底層，保留原始球頭上部與高光覆於其上；完整球體下緣不加水平遮罩。球頭位置、縮放與底座動作沿用既有設定。
圖片成功載入後才切換至分層遮擋；載入失敗或尚未完成時保留原始球頭與頸環，避免平切下緣與白色空隙。
金屬頸環獨立分層於球頭後方，直立／回位中間／拉到底分別退入 0／6／24 個原圖像素，不以透明度淡出。
頸環裁片從局部 y=116 開始，排除 y=112..115 夾帶的舊球頭紅色薄邊；整片額外上移 1 個原圖像素，使金屬托口貼入完整球面後方。球頭、桿身與底座的既有動作不變。
桿身採單一連續裁片 y=128..303，以底端為基準縱向映射至 y=90..303，取代兩段斜桿裁片拼接，避免接縫橫向錯位。球頭大小與路徑、底座動作不變。
完整球面與原圖高光共用同一個圓形外框，原圖高光在接近外圈時漸淡，避免雙層輪廓或原圖下緣超出圓形邊界。

## 生成提示

Create ONE production sprite for the existing photorealistic slot machine in the supplied reference image. Reference is appearance only: extract/recreate ONLY its LEFT glossy deep ruby-red spherical lever handle. One ball, front view, same characteristic faceted-looking softbox white reflections at upper left and upper right, rich dark red rounded lower shading, polished lacquer appearance. Match existing red ball's material, not translucent glass, not bright plastic, not a billiard ball.
Deliver a square PNG with a GENUINELY TRANSPARENT alpha background. Center ONE perfectly round sphere, diameter about 84% of image width, all edges fully visible, transparent margin on all sides. Complete smooth rounded lower hemisphere, including the area previously hidden by the brass neck. CRITICAL no brass ring, no collar, no rod, no socket, no connector, no protrusion, no flat bottom, no black hole, no cast shadow outside sphere, no machine/cabinet, no labels, no text, no other objects. The entire visible object is a single complete red sphere, opaque inside and transparent outside. Preserve specular white highlights and subtle original red material texture. This sprite will sit in front of a separately animated metal collar, so its bottom silhouette MUST be a clean continuous red circular curve.
