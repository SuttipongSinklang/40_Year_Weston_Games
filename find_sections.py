# -*- coding: utf-8 -*-
"""หา section จากแถบหัวข้อส้ม + แบ่งเซลล์ไอคอนในแต่ละ section จากช่องว่างโปร่งใส"""
from PIL import Image

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
px = img.load()

def count_orange(y):
    c = 0
    for x in range(0, W, 2):
        r, g, b, a = px[x, y]
        if a > 200 and r > 190 and 80 < g < 170 and b < 90:
            c += 1
    return c

# แถวหัวข้อส้ม
orange_rows = [y for y in range(H) if count_orange(y) > 15]
hdr_bands = []
for y in orange_rows:
    if hdr_bands and y - hdr_bands[-1][1] <= 3:
        hdr_bands[-1][1] = y
    else:
        hdr_bands.append([y, y])
print("HEADER BANDS (orange):")
for a, b in hdr_bands:
    print(f"  y {a}-{b}")

# section = จากท้าย header ถึง header ถัดไป
bounds = []
for i, (a, b) in enumerate(hdr_bands):
    y0 = b + 2
    y1 = hdr_bands[i + 1][0] - 2 if i + 1 < len(hdr_bands) else H
    if y1 - y0 > 20:
        bounds.append((y0, y1))

print("\nSECTIONS (content area):")
for si, (y0, y1) in enumerate(bounds):
    print(f"  S{si}: y {y0}-{y1} (h={y1-y0})")
    # แบ่งแถวย่อยใน section จากแถวที่เกือบว่าง
    sub = []
    in_r = False
    for y in range(y0, y1):
        cnt = sum(1 for x in range(0, W, 2) if px[x, y][3] > 12)
        busy = cnt > 4
        if busy and not in_r:
            rs = y; in_r = True
        elif not busy and in_r:
            if y - rs >= 15:
                sub.append((rs, y))
            in_r = False
    if in_r:
        sub.append((rs, y1))
    for (ry0, ry1) in sub:
        # คอลัมน์ในแถวย่อยนี้
        segs = []
        in_s = False
        for x in range(W):
            cnt = sum(1 for y in range(ry0, ry1, 2) if px[x, y][3] > 12)
            busy = cnt > 2
            if busy and not in_s:
                sx = x; in_s = True
            elif not busy and in_s:
                if x - sx >= 18:
                    segs.append((sx, x))
                in_s = False
        if in_s:
            segs.append((sx, W))
        txt = " ".join(f"({a},{b})" for a, b in segs)
        print(f"    row y{ry0}-{ry1}: {len(segs)} cells: {txt}")
