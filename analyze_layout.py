# -*- coding: utf-8 -*-
"""วิเคราะห์โครงสร้าง Atlas: แถวย่อยในแบนด์ใหญ่ + เซลล์ตามช่องว่างโปร่งใสในแกนคอลัมน์"""
from PIL import Image

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
px = img.load()

def row_count(y):
    c = 0
    for x in range(W):
        if px[x, y][3] > 12:
            c += 1
    return c

def col_count(y0, y1, x):
    c = 0
    for y in range(y0, y1):
        if px[x, y][3] > 12:
            c += 1
    return c

# หาแถวย่อยทั้งภาพ: ช่วง y ที่มีพิกเซลทึบมากกว่า 5
bands = []
in_b = False
for y in range(H):
    busy = row_count(y) > 5
    if busy and not in_b:
        s = y; in_b = True
    elif not busy and in_b:
        if y - s >= 10:
            bands.append((s, y))
        in_b = False
if in_b:
    bands.append((s, H))

print("ROW BANDS:")
for (y0, y1) in bands:
    print(f"  y {y0}-{y1}  (h={y1-y0})")
    # ภายในแถว: หาเซกเมนต์คอลัมน์ที่แยกกันด้วยช่องว่างโปร่งใส
    segs = []
    in_s = False
    for x in range(W):
        busy = col_count(y0, y1, x) > 3
        if busy and not in_s:
            sx = x; in_s = True
        elif not busy and in_s:
            if x - sx >= 15:
                segs.append((sx, x))
            in_s = False
    if in_s:
        segs.append((sx, W))
    txt = "  ".join(f"[{a}-{b}](w={b-a})" for a, b in segs)
    print(f"    cols: {txt}")
