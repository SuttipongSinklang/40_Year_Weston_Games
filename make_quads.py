# -*- coding: utf-8 -*-
"""แบ่ง Atlas เป็น 4 ช่วง (2x2) พร้อมกริดแดงทุก 50px ติดตัวเลขพิกัดจริงของภาพเต็ม"""
from PIL import Image, ImageDraw

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
OUT = r"D:\40 Year Weston Games\crops"
img = Image.open(SRC).convert("RGBA")
W, H = img.size
STEP = 50

quads = [
    ("_q1", 0, 0, W // 2, H // 2),
    ("_q2", W // 2, 0, W, H // 2),
    ("_q3", 0, H // 2, W // 2, H),
    ("_q4", W // 2, H // 2, W, H),
]
for name, x0, y0, x1, y1 in quads:
    crop = img.crop((x0, y0, x1, y1))
    bg = Image.new("RGBA", crop.size, (255, 255, 255, 255))
    bg.alpha_composite(crop)
    draw = ImageDraw.Draw(bg)
    for x in range(0, crop.width + 1, STEP):
        gx = x0 + x  # พิกัดจริงในภาพเต็ม
        draw.line([(x, 0), (x, crop.height)], fill=(255, 0, 0, 180), width=1)
        draw.text((x + 2, 2), str(gx), fill=(200, 0, 0))
    for y in range(0, crop.height + 1, STEP):
        gy = y0 + y
        draw.line([(0, y), (crop.width, y)], fill=(255, 0, 0, 180), width=1)
        draw.text((2, y + 2), str(gy), fill=(200, 0, 0))
    bg.convert("RGB").save(f"{OUT}/{name}.png")
    print("saved", name, bg.size)
