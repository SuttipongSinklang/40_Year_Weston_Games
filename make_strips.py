# -*- coding: utf-8 -*-
"""ตัดแถบ section พร้อมหัวข้อ ให้ vision อ่านจำนวน/ชื่อไอคอน"""
from PIL import Image

SRC = r"D:\40 Year Weston Games\UI Icon Atlas.png"
OUT = r"D:\40 Year Weston Games\crops"
img = Image.open(SRC).convert("RGBA")

STRIPS = {
    "s0": (110, 180),
    "s1": (170, 220),
    "s2": (270, 330),
    "s3": (350, 485),
    "s4": (480, 600),
    "s5": (592, 722),
    "s6": (724, 826),
    "s7": (828, 940),
    "s8": (940, 1016),
}
for name, (y0, y1) in STRIPS.items():
    crop = img.crop((0, y0, img.width, y1)).convert("RGBA")
    bg = Image.new("RGB", crop.size, (255, 255, 255))
    bg.paste(crop, (0, 0), crop)
    bg.save(f"{OUT}/_{name}.png")
    print("saved", name, bg.size)
