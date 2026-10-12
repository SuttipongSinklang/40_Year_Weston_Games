# เปิดระบบ "ข้อมูลเกมตามบัญชี LINE" (LINE AUTH SETUP)

สิ่งที่เปลี่ยน: ผู้เล่นไม่ผูกกับเครื่อง (anonymous ต่อเบราว์เซอร์) อีกต่อไป — ข้อมูลเกม
(workouts, days, runs, โปรไฟล์สุขภาพ) จะผูกกับ **บัญชี LINE** ผ่าน Supabase Auth (LINE provider)
ล็อกอินที่เครื่องไหน ข้อมูลตามไปเครื่องนั้น และครั้งแรกที่อัปเกรด ระบบจะย้ายข้อมูลเดิมของเครื่องนั้น
มาให้บัญชี LINE อัตโนมัติ (RPC `weston_adopt_progress`)

> จนกว่าจะทำขั้นตอนนี้ครบ เกมยังเล่นได้ปกติแบบ anonymous เหมือนเดิม (ระบบตรวจเจอว่ายังไม่เปิด
> provider แล้วข้ามไปเอง) — ทำเสร็จเมื่อไหร่ อัปเกรดเริ่มทำงานเองทันที ไม่ต้องแก้โค้ดเพิ่ม

## 1) รัน SQL บนโปรเจกต์เกม (jlweqxpkqgnjcwcgisfj)

Supabase Dashboard → SQL Editor → รันทั้งไฟล์ `supabase/line-auth.sql`
(สร้างตาราง `weston_adopted` + RPC `weston_adopt_progress` — idempotent รันซ้ำได้)

## 2) เปิด LINE provider ใน Supabase Auth

Supabase Dashboard (โปรเจกต์เกม) → **Authentication → Providers → LINE** → Enable
- Channel ID: `2011737916`
- Channel Secret: ดูจาก **LINE Developers → LINE Login channel (Weston40Game) → Channel settings → Channel secret**

## 3) เพิ่ม Callback URL ฝั่ง LINE Developers

LINE Developers → LINE Login channel `2011737916` → **LINE Login settings → Callback URL** เพิ่ม:

```
https://jlweqxpkqgnjcwcgisfj.supabase.co/auth/v1/callback
```

(คง URL อื่นที่มีอยู่ไว้ อย่าลบ — LIFF กับ OAuth ใช้ร่วมแชแนลเดียวกันได้)

## 4) อนุญาต redirect กลับมาที่เว็บเกม

Supabase Dashboard → **Authentication → URL Configuration**
- Site URL: `https://p.westonsupa.xyz`
- Redirect URLs เพิ่ม: `https://p.westonsupa.xyz/**`

## 5) ทดสอบ

1. เปิด `https://p.westonsupa.xyz/` (หรือลิงก์ LIFF ในแอป LINE)
2. ผ่านประตู LINE แล้ว จะเด้งไปหน้า authorize ของ Supabase×LINE อีก **หนึ่งครั้งเดียว** (กดยินยอม) แล้วกลับมาเกมเอง
3. ครั้งต่อไปเข้าเลยไม่ต้องกดอะไรเพิ่ม
4. ข้อมูลเดิมของเครื่อง (ถ้ามี) จะถูกย้ายมาให้อัตโนมัติ — streak/สถิติ/ประวัติวิ่งควรกลับมา

## หมายเหตุ

- ผู้เล่นใหม่ที่ไม่เคยมีข้อมูล: หน้าแรกจะแสดง streak 0 และสถิติเป็น "—" จนกว่าจะกรอกข้อมูลสุขภาพ (เลิกใช้ตัวเลขตัวอย่าง 18/36/22.5/62.4 แล้ว)
- ถ้ามีหลายเครื่องที่เคยเล่น (มือถือ + เดสก์ท็อป) ระบบจะย้ายข้อมูลจาก "เครื่องแรกที่ล็อกอิน" เท่านั้น
  เครื่องถัดไปจะเห็นข้อมูลบัญชี LINE หลังการย้ายครั้งแรกแล้ว — ถ้าอยากรวมทุกเครื่อง บอกแอดมินให้รวม SQL เพิ่มได้
- ปุ่มล็อกเอาต์: ปัจจุบัน session ของเกมจะจำไว้ตามอายุ token ของ Supabase (ปกติ ~30 วัน) — ไม่ต้องล็อกอินใหม่ทุกครั้ง
