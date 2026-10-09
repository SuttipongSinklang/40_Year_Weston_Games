# -*- coding: utf-8 -*-
"""ตรวจจับ "ไทล์ขาว" ใน Atlas: หาสี่เหลี่ยมขาวมุมมน (ที่มี glyph อยู่ข้างใน)
วิธี: สแกน run สีขาวต่อแถว -> รวม run ที่ overlap กันข้ามแถวเป็นสี่เหลี่ยม
ผลลัพธ์: crops/tile_NN.png (ตัดรวมขอบไทล์) + _tiles.png (ชีตสรุปให้ vision ตั้งชื่อ)
"""
import os
from PIL import Image, ImageDraw

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
OUT = r"D:\40 Year Weston Games\crops"
os.makedirs(OUT, exist_ok=True)
img = Image.open(SRC).convert("RGBA")
W, H = img.size
px = img.load()

def is_white(x, y):
    r, g, b, a = px[x, y]
    return a > 200 and r > 232 and g > 232 and b > 232

# หา white runs ต่อแถว (สุ่มตัวอย่างทุก 2px เพื่อความเร็ว)
runs_per_row = {}
for y in range(0, H, 2):
    runs = []
    sx = None
    for x in range(0, W, 2):
        w = is_white(x, y)
        if w and sx is None:
            sx = x
        elif not w and sx is not None:
            if x - sx >= 30:
                runs.append((sx, x))
            sx = None
    if sx is not None and W - sx >= 30:
        runs.append((sx, W))
    if runs:
        runs_per_row[y] = runs

# รวม run เป็นสี่เหลี่ยม: rect = [x0,x1,y0,y1]
rects = []  # active
finished = []
for y in sorted(runs_per_row):
    row_runs = runs_per_row[y]
    used = [False] * len(row_runs)
    keep = []
    for r in rects:
        best_i, best_ov = -1, 0
        for i, (a, b) in enumerate(row_runs):
            if used[i]:
                continue
            ov = min(r[1], b) - max(r[0], a)
            if ov > best_ov:
                best_ov, best_i = ov, i
        if best_i >= 0 and best_ov >= (r[1] - r[0]) * 0.45:
            a, b = row_runs[best_i]
            used[best_i] = True
            r[0] = min(r[0], a); r[1] = max(r[1], b); r[3] = y
            keep.append(r)
        else:
            finished.append(r)
    for i, (a, b) in enumerate(row_runs):
        if not used[i]:
            keep.append([a, b, y, y])
    rects = keep
finished.extend(rects)

# กรอง: สี่เหลี่ยมใกล้เคียงจัตุรัส ขนาด 40-260px
tiles = []
for x0, x1, y0, y1 in finished:
    w, h = x1 - x0, y1 - y0
    if 40 <= w <= 260 and 40 <= h <= 260 and 0.55 <= w / h <= 1.8:
        tiles.append((x0, y0, x1, y1))

# ตัดซ้ำ (ซ้อนกันมากกว่า 70%)
def overlap(a, b):
    ox = min(a[2], b[2]) - max(a[0], b[0])
    oy = min(a[3], b[3]) - max(a[1], b[1])
    if ox <= 0 or oy <= 0:
        return 0
    inter = ox * oy
    return inter / min((a[2]-a[0])*(a[3]-a[1]), (b[2]-b[0])*(b[3]-b[1]))

dedup = []
for t in sorted(tiles, key=lambda t: -(t[2]-t[0])*(t[3]-t[1])):
    if all(overlap(t, u) < 0.6 for u in dedup):
        dedup.append(t)
tiles = sorted(dedup, key=lambda t: (t[1] // 80, t[0]))
print(f"tiles found: {len(tiles)}")

files = []
for i, (x0, y0, x1, y1) in enumerate(tiles):
    pad = 1
    crop = img.crop((max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)))
    name = f"tile_{i:02d}.png"
    crop.save(os.path.join(OUT, name))
    files.append((name, x0, y0, x1, y1))
    print(name, (x0, y0, x1, y1), f"{x1-x0}x{y1-y0}")

# ชีตสรุป 10 คอลัมน์
COLS = 10
CELL = 120
rows = (len(files) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * CELL, rows * CELL), (235, 235, 235))
draw = ImageDraw.Draw(sheet)
for idx, (name, *_r) in enumerate(files):
    crop = Image.open(os.path.join(OUT, name)).convert("RGBA")
    scale = min((CELL - 24) / crop.width, (CELL - 24) / crop.height)
    crop = crop.resize((max(1, int(crop.width * scale)), max(1, int(crop.height * scale))))
    cx, cy = (idx % COLS) * CELL, (idx // COLS) * CELL
    sheet.paste(crop, (cx + (CELL - crop.width) // 2, cy + (CELL - crop.height) // 2), crop)
    draw.text((cx + 6, cy + 4), str(idx), fill=(220, 0, 0))
sheet.save(os.path.join(OUT, "_tiles.png"))
print("sheet:", os.path.join(OUT, "_tiles.png"))
