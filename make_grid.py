# -*- coding: utf-8 -*-
"""วางกริดพิกัดทับ Atlas (เส้นทุก 100px + ตัวเลขกำกับ) เพื่อให้ vision ระบุพิกัดไอคอน"""
from PIL import Image, ImageDraw

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
DST = r"D:\40 Year Weston Games\crops\_grid.png"

img = Image.open(SRC).convert("RGBA")
# พื้นหลังขาว + atlas อยู่บนสุด
bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
bg.alpha_composite(img)
draw = ImageDraw.Draw(bg)
STEP = 100
for x in range(0, img.width + 1, STEP):
    draw.line([(x, 0), (x, img.height)], fill=(255, 0, 0, 200), width=2)
    draw.text((x + 3, 3), str(x), fill=(200, 0, 0, 255))
for y in range(0, img.height + 1, STEP):
    draw.line([(0, y), (img.width, y)], fill=(255, 0, 0, 200), width=2)
    draw.text((3, y + 3), str(y), fill=(200, 0, 0, 255))
bg.convert("RGB").save(DST)
print("saved", DST, bg.size)
