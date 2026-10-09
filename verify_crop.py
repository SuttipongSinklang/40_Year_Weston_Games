# -*- coding: utf-8 -*-
"""รอบ 2: แก้พิกัด trophy (+80px ตามรายงาน) + เพิ่ม icon อื่นที่ต้องการ แล้วตรวจอีกรอบ"""
from PIL import Image, ImageDraw

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
OUT = r"D:\40 Year Weston Games\crops"
img = Image.open(SRC).convert("RGBA")

CANDIDATES = {
    "nav_home":     (745, 285, 805, 355),
    "nav_trophy":   (890, 285, 950, 355),
    "nav_target":   (955, 285, 1015, 355),
    "nav_calendar": (1020, 285, 1080, 355),
    "nav_people":   (1085, 285, 1145, 355),
}

sheet = Image.new("RGB", (len(CANDIDATES) * 200, 240), (255, 255, 255))
draw = ImageDraw.Draw(sheet)
for i, (name, (x0, y0, x1, y1)) in enumerate(CANDIDATES.items()):
    px0, py0 = max(0, x0 - 45), max(0, y0 - 45)
    px1, py1 = min(img.width, x1 + 45), min(img.height, y1 + 45)
    crop = img.crop((px0, py0, px1, py1)).convert("RGBA")
    bg = Image.new("RGBA", crop.size, (255, 255, 255, 255))
    bg.alpha_composite(crop)
    d2 = ImageDraw.Draw(bg)
    d2.rectangle([x0 - px0, y0 - py0, x1 - px0, y1 - py0], outline=(255, 0, 0), width=3)
    sheet.paste(bg.convert("RGB"), (i * 200 + 10, 40))
    draw.text((i * 200 + 10, 8), f"{i+1}", fill=(200, 0, 0))
sheet.save(OUT + "/_verify2.png")
print("saved")
