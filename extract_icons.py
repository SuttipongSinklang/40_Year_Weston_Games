# -*- coding: utf-8 -*-
"""ตัดไอคอนออกจาก UI Icon Atlas.png ด้วย PIL ล้วน
วิธี: ลดความละเอียดเป็นบล็อก 4px -> หา connected components -> crop กลับที่ขนาดเต็ม
ผลลัพธ์: crops/icon_XX.png + contact sheet สำหรับให้ AI vision ระบุว่าแต่ละอันคืออะไร
"""
import os
from collections import deque
from PIL import Image, ImageDraw

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
OUT = r"D:\40 Year Weston Games\crops"
os.makedirs(OUT, exist_ok=True)

img = Image.open(SRC).convert("RGBA")
W, H = img.size
BLOCK = 4
gw, gh = W // BLOCK, H // BLOCK

# occupancy grid (บล็อกใดมีพิกเซลทึบบ้าง)
px = img.load()
occ = [[False] * gw for _ in range(gh)]
for by in range(gh):
    for bx in range(gw):
        found = False
        for y in range(by * BLOCK, min(by * BLOCK + BLOCK, H)):
            for x in range(bx * BLOCK, min(bx * BLOCK + BLOCK, W)):
                if px[x, y][3] > 12:
                    found = True
                    break
            if found:
                break
        occ[by][bx] = found

# connected components (4-neighbour BFS)
seen = [[False] * gw for _ in range(gh)]
blobs = []
for by in range(gh):
    for bx in range(gw):
        if occ[by][bx] and not seen[by][bx]:
            q = deque([(bx, by)])
            seen[by][bx] = True
            minx = maxx = bx
            miny = maxy = by
            area = 0
            while q:
                cx, cy = q.popleft()
                area += 1
                if cx < minx: minx = cx
                if cx > maxx: maxx = cx
                if cy < miny: miny = cy
                if cy > maxy: maxy = cy
                for nx, ny in ((cx+1, cy), (cx-1, cy), (cx, cy+1), (cx, cy-1)):
                    if 0 <= nx < gw and 0 <= ny < gh and occ[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = True
                        q.append((nx, ny))
            blobs.append((minx * BLOCK, miny * BLOCK, (maxx + 1) * BLOCK, (maxy + 1) * BLOCK, area))

# กรองเฉพาะ blob ขนาดไอคอนขึ้นไป (สัก 24px ขึ้นไปทั้งคู่) และเรียงตามตำแหน่ง
blobs = [b for b in blobs if b[2]-b[0] >= 24 and b[3]-b[1] >= 24 and b[4] >= 120]
blobs.sort(key=lambda b: (b[1] // 60, b[0]))

print(f"found {len(blobs)} blobs")
files = []
for i, (x0, y0, x1, y1, _) in enumerate(blobs):
    pad = 2
    crop = img.crop((max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)))
    name = f"icon_{i:02d}.png"
    crop.save(os.path.join(OUT, name))
    files.append((name, x0, y0, x1, y1))
    print(name, (x0, y0, x1, y1), f"{x1-x0}x{y1-y0}")

# contact sheet: 8 คอลัมน์ ให้ AI vision อ่าน
COLS = 8
CELL = 130
rows = (len(files) + COLS - 1) // COLS
sheet = Image.new("RGBA", (COLS * CELL, rows * CELL), (255, 255, 255, 255))
draw = ImageDraw.Draw(sheet)
for idx, (name, *_rest) in enumerate(files):
    crop = Image.open(os.path.join(OUT, name))
    scale = min((CELL - 30) / crop.width, (CELL - 30) / crop.height, 1)
    crop = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))))
    cx = (idx % COLS) * CELL
    cy = (idx // COLS) * CELL
    sheet.paste(crop, (cx + (CELL - crop.width) // 2, cy + (CELL - crop.height) // 2), crop)
    draw.text((cx + 8, cy + 4), str(idx), fill=(200, 0, 0, 255))
sheet.convert("RGB").save(os.path.join(OUT, "_sheet.png"))
print("sheet saved:", os.path.join(OUT, "_sheet.png"))
