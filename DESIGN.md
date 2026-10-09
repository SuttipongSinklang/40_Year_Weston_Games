---
version: alpha
name: "Weston Fit Quest"
description: "เกมฟิตเนสบนเว็บสำหรับมือถือ โทนสวนสนุกกลางท้องฟ้า — ตัวละคร 3D ยืนกลางสวน การ์ดครีม ปุ่มส้ม เด้งดึ๋งแต่อ่านง่าย"
colors:
  primary: "#F5B83D"        # orange — ปุ่ม action / nav / accent หลัก
  primary-dark: "#DE9B1F"
  primary-shadow: "#C9870F"
  secondary: "#3DBE5B"      # green — ความสำเร็จ / progress / level
  success: "#3DBE5B"
  success-deep: "#2E9B47"
  success-light: "#4CE06B"
  danger: "#FF5A5A"
  background: "#FFF6E3"     # cream — พื้นผิวการ์ด
  background-dark: "#F4E7C6" # cream-dark — เส้นขอบการ์ด
  sky: "#4FB3E8"
  sky-light: "#9FDDF7"
  sky-pale: "#CFF0FC"
  grass: "#5EC96F"
  navy: "#1E3A5F"           # ตัวหนังสือหลัก
  navy-dark: "#16293F"
  navy-muted: "#5B7191"
typography:
  sans:
    fontFamily: "'Mitr', sans-serif"
  mono:
    fontFamily: "'Nunito', 'Mitr', sans-serif"
rounded:
  pill: "999px"
  lg: "22px"
  md: "16px"
  control: "12px"
spacing:
  section-gap: "0.75rem"
  page-gutter: "14px"
  page-max: "50rem"
  sync-reserve: "76px"
  nav-height: "82px"
  game-hud: "218px"
  quest-dock: "104px"
components:
  button: { }
  card: { }
  chip: { }
  nav: { }
  progress: { }
  tab: { }
  toast: { }
---

# Weston Fit Quest Design System

## Home treadmill mode

- Reuse running metrics, pause/resume and local history. Native radio group selects outdoor GPS or treadmill before starting; selection is locked while a draft remains unsaved. Treadmill defaults to automatic phone steps (distance = steps × configured stride, labeled estimated); manual console distance remains optional. Step count has a separate metric, avoiding repeated live-region announcements per step. No fabricated GPS or per-km splits.
- Browser tracker owner is `run-tracker.js`; native treadmill uses `run-native-treadmill.js` and a durable native journal separate from the outdoor plugin. Browser treadmill pauses when hidden; native treadmill continues/catches up after locking. Terminated-process recovery is paused. Map/live sharing controls are hidden in treadmill mode. History/details/cloud backup preserve activity type.
- `run-steps.js` owns permission, motion filtering and source lifecycle. Android uses step detector/counter and Activity Recognition; iOS uses CMPedometer/Motion & Fitness; browser uses DeviceMotion over a secure context. Configured stride (0.30–2 m, default 0.75 m) is an estimate and stored as an optional local preference. Physical calibration/hardware validation is pending; console Bluetooth and watch integrations are not implemented.

## Live running map extension

- Reuse the canonical run map (`createRunMap`) and existing cream cards, Thai labels, native checkbox controls, green running controls and navy person markers. Live people are a separate map layer; route history stays private.
- `running.js` owns screen controls, `run-live.js` owns consent/session/freshness and lifecycle, `run-live-data.js` owns authenticated Supabase access. Viewing and sharing are independent, initially off and never persisted. Viewing never requests GPS. Sharing sends only the latest fresh fix while running and foregrounded.
- Live people update without refitting the map after its first populated view. A dedicated center button and accessible name buttons recenter on demand. Empty/disconnected states never claim that zero people are online.
- Current scope: authenticated global game map, up to 500 most recently updated positions; no nearby search or public historical routes. Foreground live sharing differs from native local background capture. Anonymous Sign-Ins must be enabled before live accounts work.

## Overview

### Creative North Star

สนุกเด็กเล่นกลางสวนสาธารณะเช้าวันอาทิตย์: ท้องฟ้าไล่จากฟ้าอ่อนไปเขียวขอบหญ้า ดวงอาทิตย์นุ่ม เมฆก้อนโต แล้ววาง "การ์ดกระดาษครีมหนา" ทับลงไปเหมือนสติกเกอร์ติดสมุดรูปวาด — ทุกการ์ดมีขอบ 2px + เงา solid แบบ sticker (0 3-4px 0) ไม่ใช้เงาฟุ้ง ขอบมนพิเศษ ตัวเลขอ้วนกลมด้วย Nunito 900

### Product context and register

- **Audience and primary job:** ผู้เล่นเกมฟิตเนสมือถือ (ภาษาไทย) แตะตัวละครเพื่อกระโดดและสะสม XP เก็บ XP ทำภารกิจ ดู streak/ปฏิทิน/อันดับ/สังคม
- **Target market(s) and evidence:** ตลาดไทย — UI ทั้งหมดภาษาไทย, ฟอนต์ Mitr, ป้ายกำกับ "ข้อมูลตัวอย่าง/ข้อมูลสุขภาพตัวอย่าง" เป็นภาษาไทย
- **Locale(s) and language policy:** th เดี่ยว (lang="th") ตัวเลขใช้รูปแบบพันหลัก comma (1,250) ไม่มีการสลับภาษา
- **Usage scene:** ถือมือถือด้วยนิ้วโป้ง บนอุปกรณ์ 320–1280px แนวตั้งเป็นหลัก มีแนวนอนจอเตี้ย เดสก์ท็อปใช้เมาส์/คีย์บอร์ดได้
- **Register:** Product-playful hybrid — โครงสร้าง UI มาตรฐานแต่ตกแต่งด้วยภาษาภูมิทัศน์ (เมฆ ดวงอาทิตย์ หญ้า)
- **Memorable signature:** ตัวละคร 3D (GLB เด็กหมวกแก๊ป) ยืนกลางสวน 3D — แตะแล้วกระโดด +1 💪 ลอยขึ้น นี่คือ signature ที่ทุกหน้ายังได้กลิ่นผ่านฉากท้องฟ้า/ต้นไม้เดียวกัน
- **Restraint:** การ์ดข้อมูล/ตารางอันดับ/ฟอร์มค้นหา ต้องเรียบ อ่านตัวเลขได้เร็ว ห้ามตกแต่งเกินจนอ่านยาก
- **Anti-references:** ไม่เอา dashboard องค์กรสีเทา-น้ำเงินเข้ม, ไม่เอา glassmorphism ฟุ้ง ๆ , ไม่เอา neumorphism — ทุกอย่างต้องยังดู "สมุดวาดรูปเด็ก"
- **Token ownership/runtime mapping:** ไฟล์นี้ **สะท้อน (mirror)** token ที่ canonical จริงอยู่ใน `webgame/css/style.css` ที่ `:root` — แก้ก็แก้ที่ CSS ก่อนแล้วอัปเดตไฟล์นี้ตาม ตาราง mapping อยู่หัวข้อ Layout/Colors

## Colors

บทบาทตาม token ใน frontmatter (ชื่อ var ใน CSS อยู่ในวงเล็บ):

- **พื้นหลังโลก (world):** `sky-light` → `sky` → `sky-pale` → เขียวอ่อน #DFF4E0 เป็น gradient แนวตั้งของ `#app` (ท้องฟ้ายามบ่ายถึงขอบหญ้า) — ไม่มี dark mode
- **พื้นผิวการ์ด:** `background` cream (#FFF6E3 / `--cream`) ขอบ `background-dark` (`--cream-dk`) เสมอ 2px
- **Action:** `primary` orange (`--orange`) พร้อมขอบ `primary-dark` และเงา solid `primary-shadow` — ใช้กับ nav, pill active, ปุ่ม retry
- **Game feedback:** สีเขียวใช้กับ XP และความสำเร็จ การเล่นเกิดจากแตะตัวละครโดยตรง ไม่มีปุ่มออกกำลังกายแยก
- **Progress:** แถบเต็มใช้ gradient `success-light`→`success-deep` (XP, mission, scorebar, goal fill, ring `stroke:var(--green)`)
- **ตัวหนังสือ:** `navy` หลัก / `navy-muted` (#5B7191) คำอธิบาย / ขาวบนพื้นส้ม-กรมท่า
- **อันดับ 1-3:** ทอง #FFD84D→#F0A81C, เงิน #D7E3EC→#9FB4C6, ทองแดง #E8A56E→#C77B3E
- **Alert:** `danger` แดง — จุดภารกิจ, หัวคอลัมน์ อา., ไอคอน like ที่กดแล้ว
- **Focus ring:** outline 3px `navy` (บน nav bar ใช้ขาว) — มองเห็นได้ทั้งบนฟ้าและครีม

## Typography

- **Mitr** (400/500/600/700) — ภาษาไทยทั้งหมด: หัวข้อ h1-h4, ป้ายกำกับ, ปุ่ม น้ำหนัก 500 ปกติ / 600 เน้น โหลดจาก Google Fonts พร้อม `display=swap`
- **Nunito** (800/900) — ตัวเลขล้วน (`--font-num`): คะแนน, XP, เหรียญ, วันที่, เปอร์เซ็นต์, rank — ตัวเลขอ้วนกลมอ่านเร็ว
- ขนาดหลัก: h2 หน้า 22px (26px เดสก์ท็อป) / ชื่อผู้เล่น 17px / ตัวเลขสถิติ 16px / ป้ายเล็ก 10.5-11.5px (ย่อยกว่านี้เฉพาะตัวเลข Nunito ที่ยังอ่านชัด)
- ป้ายกำกับข้อมูลตัวอย่าง (`mock-label`): Mitr 500 10.5px บนพื้น #FFEFC9
- ไม่มี mono/technical font แยก; ตัวเลขเดี่ยวใช้ Nunito ตาม `--font-num`

## Layout

- **กลยุทธ์: mobile-first** — base คือมือถือแนวตั้ง 320px+ แล้วค่อยขยายขึ้น ไม่มีกรอบ mockup โทรศัพท์บนเดสก์ท็อปอีกต่อไป
- **Breakpoints ทดสอบ:** 320 / 360 / 390 / 768 / 1280 + แนวนอนจอเตี้ย (orientation landscape, max-height 540)
- **โครงหน้าหลัก (mobile portrait):** HUD ย่อด้านบน (เลเวล/XP/เหรียญ) → พื้นที่ฉาก 3D ที่ไม่ทับกับ HUD หรือภารกิจ → คำแนะนำการเล่น + ภารกิจแบบแถบย่อ → bottom nav ข้อมูลสุขภาพ/streak/รายละเอียดซิงก์เปิดใน native dialog ผ่าน “ข้อมูลผู้เล่น”
- **จอใหญ่และแนวนอน:** ฉากเกมเต็มความกว้าง โปรไฟล์มุมซ้ายบน ข้อมูลผู้เล่นมุมขวาบน ภารกิจอยู่ล่างกลางบนเดสก์ท็อป และล่างซ้ายบนมือถือแนวนอน ตัวละครยังอยู่กลางฉาก
- **Geometry tokens:** `--game-hud:98px`, `--quest-dock:104px`, `--nav-h:82px` แบ่งฉากออกจากแถบ UI; มือถือแนวนอนใช้ HUD 64px และ nav 64px ภารกิจย้ายไปด้านซ้าย `--sync-h:76px` ยังใช้กับพื้นที่หัวหน้าย่อย
- **Safe area:** ใช้ `env(safe-area-inset-top/bottom)` รวมเข้า padding ของ sync-bar, hud-top, home-controls, page-scroll, nav และ viewport ใช้ `viewport-fit=cover`
- **หน้าย่อย (leaderboard/goal/calendar/social):** เลื่อนแนวตั้งใน `.page-scroll` (scrollbar บางมองเห็นได้) เนื้อหากว้างสูงสุด 800px อยู่กึ่งกลางบนจอกว้าง (`padding-inline: max(16px, 50vw - 400px)`)
- **ไม่มี horizontal overflow:** ทุก container ใช้ min-width:0 + ellipsis ตรงที่ยาว, แถวเพื่อนเลื่อนแนวนอนในกรอบตัวเอง, กำหนด grid คอลัมน์แคบลงที่ ≤359px
- **Zoom:** viewport อนุญาต zoom (ไม่ใส่ user-scalable=no / maximum-scale)
- **Token mapping CSS `:root`:** `--cream`→background, `--cream-dk`→background-dark, `--orange/-dk/-sh`→primary/-dark/-shadow, `--green/-dk/-lt`→secondary/success-deep/success-light, `--sky/-lt/-pale`→sky/sky-light/sky-pale, `--navy/-dk`→navy/navy-dark, `--red`→danger, `--grass`→grass, `--r-lg/-md`→rounded.lg/.md, `--font-th/-num`→typography.sans/mono, `--sync-h/-nav-h/-side-w`→spacing.sync-reserve/.nav-height/(panel width)

## Elevation & Depth

- ภาษาชั้นคือ **"สติกเกอร์ติดสมุด"**: การ์ดครีม = เงา solid `0 3-4px 0 rgba(30,58,95,.12-.15)` + ขอบ 2px ไม่มี blur ยกเว้นเงาเมฆ
- ปุ่มกดได้มี "ชั้นหนา" เพิ่ม: nav และภารกิจ `0 3-4px 0` สีเข้มของตัวเอง กดแล้ว translateY ลง 2px พร้อมลดเงา (pressed จริงในระบบสติกเกอร์)
- ชั้น z: sky-decor 0 → canvas 1 → screens/page-scroll และ loader 2 → home-ui 3 → popLayer 4 → sync-bar 9 → nav 10 → toast 40
- หน้าต่างข้อมูลใช้พื้นครีมและ backdrop กรมท่าโปร่ง เมื่อต้องดูข้อมูลจึงค่อยบังฉาก
- ห้ามยกชั้นด้วยสีเทา/ดำทึบทับสีฟ้า — ใช้ครีมทึบหรือครีมโปร่ง .9 เท่านั้น

## Shapes

- `rounded.pill = 999px` — ทุกอย่างที่ "ยาวมน": chip เหรียญ, streak, pill tabs, sync-bar, badge, progress bar
- `rounded.lg = 22px` (`--r-lg`) — การ์ดใหญ่ (goal hero, cal-card, summary, feed, หน้าต่างข้อมูลผู้เล่น)
- `rounded.md = 16px` (`--r-md`) — การ์ดแถว (stat-card, lb-row, mission-card)
- `rounded.control = 12px` — กล่องไอคอน (stat-ico, goal-ico, ปุ่มเดือน ‹ ›)
- ภารกิจใช้แถบมน 18px; ไม่มีปุ่มเพิ่มคะแนนในหน้าหลัก
- วงกลมเต็ม: avatar, rank-badge, จุดสถานะซิงก์, dot ปฏิทิน, goal-done
- Ring เป้าหมายเป็น SVG stroke-linecap round หนา 11

## Components

### Foundational visual states

- default: การ์งครีมขอบ cream-dk เงา solid / ปุ่ม gradient ขอบเข้ม + เงาชั้น
- hover: ไม่กำหนดพิเศษ (touch-first) — เฉพาะ cursor pointer
- focus-visible: outline 3px navy (บน nav ใช้ขาว) offset 2px ทุกปุ่ม
- active/pressed: translateY(2px) + เงาลด (nav-btn, pill, syncRetry, calPrev/calNext, missionCard)
- selected: pill active พื้นส้มข้อความขาว / nav active ไอคอนเด้งขึ้น -7px พื้นสว่างขึ้น + จุด indicator / แถว "คุณ" outline ส้ม / วันนี้ในปฏิทินพื้นส้ม
- disabled/read-only/busy: ยังไม่มีใน mockup — ถ้าเพิ่มให้ลด opacity .55 และตัดเงา
- loading: loader ซ่อนจากเทคโนโลยีช่วยอ่านเมื่อโหลดเสร็จ; เปิดเล่นกับตัวละครหลังโหลดสำเร็จ ถ้าโหลดไม่ได้แสดงคำแนะนำรีเฟรชและเก็บความคืบหน้าเดิมไว้
- like แล้ว: หัวใจแดง + นับเพิ่ม

### Buttons and actions

- ลำดับความสำคัญ: **missionCard** (เขียว gradient, 48px+, กว้างเต็มแถว — CTA เดียวของเกม) > **syncRetry** (ส้ม pill 44px ใน sync-bar) > **pill tabs / calPrev-calNext** (44px, พื้นครีม) > **like-btn** (ghost 44px)
- ทุกปุ่มสัมผัส ≥44px สูง; ข้อความปุ่ม Mitr 500-600
- missionCard อยู่ข้างการ์ดภารกิจ (มือถือ: แถวล่างซ้าย-ขวา / เดสก์ท็อป: ท้ายแผงซ้าย) ปุ่มไม่มี icon ให้ข้อความ "ออกกำลังกาย +1" เป็นตัวชี้เป้าเอง

### Navigation and data display

- Bottom nav 5 ปุ่ม (หน้าหลัก/ถ้วยรางวัล/เป้าหมาย/ปฏิทิน/สังคม) ไอคอน SVG เส้น stroke 2.1 ในกล่องส้มมน 16px + label ไทยใต้ไอคอน + จุด indicator; เดสก์ท็อปจัดกลางพร้อม gap ยืดตาม vw
- Leaderboard: grid 3 คอลัมน์ (อันดับ/ผู้เล่น/คะแนน) แถบคะแนน mini-bar + เปลิไฟ; อันดับ 1-3 มี crown; แถวคุณไฮไลต์ส้ม; ≤359px คอลัมน์แคบลง 40/1fr/78
- ปฏิทิน 7 คอลัมน์ aspect-ratio 1:1 วันที่เล่นแล้วมี 🔥 วันนี้พื้นส้ม; ปุ่มเดือนก่อนหน้า/ถัดไป 44px มี aria-label ไทย
- ข้อมูล mock (ทีม, สังคม, สุขภาพ 4 ใบ) ติดป้าย `mock-label` ทุกจุด — ห้ามนำไปอ้างว่าเป็นข้อมูลจริง ห้ามอ้างแคลอรี/สุขภาพจากการแตะ

### Forms and overlays

- ช่องค้นหาเพื่อนเป็น mock แบบ visually-only (div ไม่ใช่ input — ยังไม่มี logic)
- Toast (`#toast`): กรมท่า มุมมน 14px ลอยเหนือ nav, role="status" aria-live="polite", อยู่ระดับ app (เห็นทุกหน้าจอ) แสดง 2.5 วิ
- +1 💪 pop: ข้อความ Nunito 900 22px ลอยขึ้นจากจุดแตะ 0.95 วิ แล้วหาย
- ไม่มี dialog/bottom-sheet ในเวอร์ชันนี้

### Iconography

- ระบบไอคอนหลัก: SVG เส้น stroke 2.1 ขาว 24px ในกล่องส้ม (nav) — วาดเอง minimal
- อีโมจิเป็นไอคอนรอง: อาหาร/กล้ามเนื้อ/BMI/น้ำหนัก, กิจกรรมเป้าหมาย, avatar เพื่อน — ใช้ตามข้อมูล mock ที่ main.js สร้าง
- ตัวเลขล้วนไม่ต้องมีไอคอน (Nunito 900 คือภาษาภาพของตัวเลข); ปุ่มไทยยาว ๆ ไม่ใส่ไอคอนซ้อน

### Motion

- บุคลิก: เด้งเล็ก น้อย เร็ว — easing มาตรฐานคือ `cubic-bezier(.22,1,.36,1)` (ออก) และ `cubic-bezier(.34,1.56,.64,1)` (เด้งกลับ bounce เบา ๆ)
- ตกแต่ง: เมฆลอยช้า 26-36 วิ, ไฟเปลิไฟสั่น 1.6 วิ, ถ้วยรางวัลแกว่ง 2.4 วิ, จุดภารกิจเต้น 1.4 วิ — ทำนานไม่หยุดเพราะเป็น "ฉากมีชีวิต"
- สถานะ: XP bar 0.45 วิ, mission fill 0.4 วิ, goal fill 0.8 วิ, ring 1 วิ, screen transition 0.28 วิ (opacity+translateY 12px), toast 0.35 วิ
- ตัดด้วย `prefers-reduced-motion: reduce` — ทุก animation/transition ลดเหลือ 0.01ms เมฆหยุดนิ่ง
- บนหน้าจอสั้น ๆ ทุกอย่างยังต้องอ่านได้ครบแม้ motion ถูกปิด

### Content and data visualization

- เสียงผลิตภัณฑ์: ให้กำลังใจ สนุก สั้น ("เก่งมาก! ใกล้ครบเป้าแล้ว", "แตะตัวละครเพื่อออกกำลังกาย!")
- คำกริยาหลัก: ออกกำลังกาย / เล่น / สำเร็จ — XP คือหน่วยรางวัลเดียวที่อ้างได้; **ห้าม** อ้างแคลอรี สุขภาพ หรือผลลัพธ์ทางกายจากการแตะ
- ตัวเลขพันหลัก comma (1,250 / 3,200); หน่วยไทยตามหลัง (วัน ครั้ง XP)
- สรุปเดือน = วันที่เล่น / ครั้งที่เล่น / XP พื้นฐาน (ไม่รวมโบนัสภารกิจ ไม่ใช่ metrics สุขภาพ)
- chart มีเพียง progress (bar/ring/mini scorebar) สีเขียวบนพื้น #EADFC2 มี % ตัวเลขกำกับเสมอ (ไม่ต้องอ่านจากความยาวอย่างเดียว)

## Do's and Don'ts

- **Do:** คงโทน "สวนสนุกบนท้องฟ้า" — ฟ้า gradient เป็นพื้น การ์ดครีมสติกเกอร์ทับ ทุกสิ่งใหม่ต้องกลมมนและมีเงา solid
- **Do:** ออกแบบที่ 320px ก่อนเสมอ แล้วปล่อยให้จอใหญ่ได้พื้นที่ตัวละคร/เนื้อหาเพิ่ม — ไม่ย้าย element ที่ runtime JS ผูก ID ไว้
- **Do:** ป้าย "ข้อมูลตัวอย่าง/ข้อมูลสุขภาพตัวอย่าง" ต้องติดกับข้อมูล mock ทุกครั้งที่เพิ่มใหม่
- **Don't:** อย่าใส่กรอบ mockup โทรศัพท์ ล็อก zoom หรือซ่อน scrollbar — ผู้ใช้ต้อง zoom และ scroll ได้จริง
- **Don't:** อย่าอ้างสุขภาพ/แคลอรีจากการแตะตัวละคร — การแตะให้เพียงจำนวนครั้งและ XP
- **Don't:** อย่าลดปุ่ม control ต่ำกว่า 44px หรือใช้เงาเทาโปร่งบนการ์ดแทนเงา solid ของระบบสติกเกอร์

## Character-first game revision — 2026-10-08

ผู้ใช้ขอเอาปุ่มออกกำลังกายออกและไม่ให้ข้อมูลบังตัวละคร จึงใช้ฉากเล่นระหว่าง HUD และแถบภารกิจ เลื่อนข้อมูลสุขภาพและสถานะซิงก์ไป native dialog การแตะต้องโดนโมเดลจริงจึงเพิ่มคะแนน คีย์บอร์ด Enter/Space ทำสิ่งเดียวกัน การแตะฉากหลังและลากไม่เพิ่มคะแนน Dialog ปิดด้วย Escape และคืนโฟกัสให้ปุ่มเปิด

## Restore visible data — 2026-10-08

ตามคำขอล่าสุด นำ streak และข้อมูลสุขภาพตัวอย่างทั้งสี่รายการกลับมาบนหน้าหลัก มือถือแนวตั้งปกติใช้การ์ดสี่คอลัมน์เหนือฉากและสงวน HUD 218px จอเตี้ยย้ายข้อมูลเป็นแถบซ้ายแคบ โดยฉากเริ่มที่ x=116px จอใหญ่และแนวนอนวางข้อมูลด้านซ้าย ตัวละครยังมีพื้นที่ของตัวเอง ไม่มีปุ่มออกกำลังกาย รายละเอียดการเชื่อมต่อยังเปิดจากข้อมูลผู้เล่น

## GPS running — 2026-10-08

เพิ่มหน้าวิ่งใน navigation เดิมเป็นหน้าที่หก โดยใช้สีและฟอนต์เดิม: ตัวเลขระยะทาง Nunito หนาใหญ่ พื้นครีม แถบเลือกมุมมองกรมท่า ปุ่มเริ่ม/วิ่งต่อเขียวและปุ่มพักส้ม แผนที่เป็นพื้นที่ทำงานของเส้นทางจริง ไม่มีการวาดเส้นทางตัวอย่างเป็นผลการวิ่ง ผู้เล่นเลือกเปิดแผนที่ถนนจาก OpenStreetMap เอง ก่อนเปิดแสดงเพียงเส้นทางในเครื่อง

สถานะพร้อมวิ่ง/รอ GPS/กำลังวิ่ง/พัก/จบ ใช้ข้อความร่วมกับสี เวลา เพซ และระยะทางอัปเดตจาก GPS ที่ผ่านตัวกรอง ข้อความกำกับแจ้งให้เปิดหน้าจอไว้ การสลับแอปพักให้เอง ไม่มีสัญญาว่าติดตามได้เมื่อปิดหน้าจอ ปุ่มควบคุม fixed อยู่เหนือ bottom nav เสมอ และเนื้อหาสงวนพื้นที่ล่างให้แถบนี้ จอ 320px ลดไอคอน nav เป็น 44px เพื่อรองรับหกเมนู

ประวัติใช้รายการการวิ่งที่กดเปิดรายละเอียดใน native dialog ได้ ดูเส้นทาง สปลิตรายกิโลเมตร ส่งออก GPX และเลือกสำรองบนบัญชี Supabase โดยต้องอนุญาตการส่งพิกัดของการวิ่งนั้นก่อน สถานะเก็บในเครื่อง/รอสำรอง/สำรองแล้วแยกกัน วันที่แสดงภาษาไทยใน Asia/Bangkok

## Native running — 2026-10-08

ใช้หน้าวิ่งและตัวควบคุมเดิมในแอป Android/iPhone เพิ่มความแตกต่างเฉพาะข้อความการทำงาน: แอปที่มี native recorder อธิบายว่าล็อกจอและสลับแอปได้ จบ/พักหยุด GPS และ force-stop อาจหยุดบันทึก เว็บยังแสดงข้อความให้เปิดหน้าจอไว้ ทั้งสองแบบไม่ใช้สีเพียงอย่างเดียวแสดงสถานะ แอปไม่ขอ screen wake lock และไม่พักจากการเปลี่ยนเมนู GPX เปิดตัวเลือกแชร์ไฟล์ของระบบ ใช้ปุ่มเดิมพร้อม busy state ขณะส่งออก ไม่มีการเปลี่ยนสี ฟอนต์ หรือรูปแบบหน้าจอ การรองรับในโค้ดต้องแยกจากผล build และการทดสอบเครื่องจริง

### Native treadmill continuity (2026-10-09)
Native home treadmill is now owned by TreadmillJournal/TreadmillService (Android) and NativeTreadmill (iOS), presented through run-native-treadmill.js. Browser remains foreground-only. Platform hints distinguish Android background service from iPhone cached-step reconciliation on unlock; estimated distance remains explicit. No hidden native lifecycle pause or screen wake-lock requirement. Native durable history acknowledges only after local save; old foreground drafts are finalized before new native capture. Hardware build/lockscreen acceptance remains unverified. Existing layout/colors/navigation unchanged.

## Map-first running reference — 2026-10-09

The user's MapMyRun screenshot governs the running workspace only: a white surface, prominent street-map area, red route, green start and red end markers, large duration/distance, and a green inline Start/Pause/Finish control below the map. Running retains Thai labels, kilometres, actual GPS/step data, and the shared six-item game navigation. The game HUD keeps its existing sky/cream style. This revision supersedes the older running fixed-action layout; actions participate in document flow to avoid covering content. Advanced map/live-sharing settings use native details disclosure; street tiles remain explicit opt-in and the map shortcut opens and focuses that consent control. Treadmill hides GPS/map settings and retains step-estimate calibration.

Runtime mapping is owned by webgame/css/style.css: --run-surface #fff, --run-ink #242a2a, --run-muted #647076, --run-rule #e7eaeb, --run-action #087e46, --run-route #ed233b. run-map.js uses the same route value for Leaflet. Post-run dialog puts route before the 3-column statistics grid. Steps/cadence come only from phone-step runs; stride is labelled as configured, not measured. Calories, elevation gain and heart rate show an explained missing-data dash until actual measurement exists. No reference sample numbers or route are inserted.

### Running defaults — 2026-10-09
The user explicitly requested street maps and companion settings as consistent defaults. Each entry to Running opens runSettings and enables street tiles, including after reload or after disabling them during the previous visit. This supersedes the earlier street-map opt-in default. Controls still permit disabling tiles/collapsing settings for the current visit. GPS capture and live position sharing remain separately initiated by the player; no automatic location permission or sharing is added.

### Remove companion panel and simplify basemap — 2026-10-09
The latest annotated review supersedes the running settings disclosure. Remove runSettings, companion controls, street toggle and the map-settings shortcut from the running page. Unmount the unused live-presence controller so removed controls do not leave hidden sharing/subscription behavior. Keep automatic street basemap, GPS capture, treadmill, history and GPX export. Export lives below the running hints. Use the existing OpenStreetMap provider at initial zoom 11 instead of 12, with grayscale .82/saturation .4 and tile-pane opacity .72. This reduces label density and background competition without filtering route/marker overlays or attribution. No new map-provider account/key is required.

### Treadmill defaults without configuration — 2026-10-09
Remove the normal treadmill configuration panel per the latest annotated request. New sessions always request automatic phone steps with the existing 0.75 m per-step application default; old local calibration preferences no longer affect new sessions. This is an estimate, not a universal measured human stride. Keep time, distance labelled as estimated, pace, step count and the short carry-phone/platform hint visible. Preserve persisted runs and their actual stride. Only a recovered unfinished manual-distance session gets the minimal input needed to finish that old record; new sessions expose no setup form or automatic/manual toggle.

## Running test fixes — 2026-10-09

Finished runs now save privately online automatically; no GPX export or backup-consent/button appears in the running UI. Durable pending records retry after reconnect, foreground return, reload and every 30 seconds while visible. A server confirmation is required for the saved label; old local-only records are not silently uploaded. Numbered orange P / green R markers and an accessible ordered event list identify explicit pause/resume pairs. Resume positions come from the first accepted fresh fix; GPS gaps alone create no pause markers. The summary map now has the same full-height Leaflet container as the active map and fits the saved route on opening.

The user explicitly requires a website. No installation/download CTA is shown. Visibility changes checkpoint the active session without auto-pausing or clearing the GPS/motion listener. Foreground return renews the same lease before storing new fixes; time is calculated from timestamps. Temporary GPS timeout/unavailability keeps waiting for fresh fixes; revoked permission still pauses. Background GPS/motion delivery is controlled by the browser and cannot be guaranteed. GPS gaps over 30 seconds break the route, add no bridge distance and are disclosed in the summary. Page exit/discard recovery remains conservative and never starts sensors by itself. Native artifacts are not the delivered solution.
