# BODY 150 Goal Engine (Experimental)

ใช้สูตรต้นฉบับที่ผู้ใช้ยืนยัน **ไม่มีการ smooth หรือสร้าง Body Fat reference เอง**
ส่วนนี้ยังไม่เชื่อม UI, Supabase, XP หรือการแจกของรางวัล

## ใช้งาน

```sh
npm test --prefix health-goal-engine
npm run simulate --prefix health-goal-engine
```

ไม่ต้องติดตั้ง dependency เพิ่ม ทดสอบด้วย Node.js ที่มี `node:test` และ `structuredClone`

```js
import { calculateGoals } from './health-goal-engine/index.mjs';

const input = {
  age: 25, sex: 'male', weight_kg: 55, bmi: 18,
  body_fat_percent: 20, muscle_mass_kg: 40,
};
const result = calculateGoals(input);
// status: needs_reference; target ทั้งสี่ค่าเป็น null
// ต้องมีตาราง Body Fat และนิยามกล้ามเนื้อจริงก่อน
```

เมื่อมีข้อมูลอ้างอิงที่องค์กรเลือกแล้ว ให้ส่ง `bodyFatReference` ซึ่งมี
`id`, `version`, `source`, `status`, และ `ranges` แยก sex/age พร้อม `bf_low/bf_high`
ส่ง `muscleDefinition`, `deviceId`, `startDate` ของเกมด้วย
ไม่มีค่าอ้างอิงถูกเลือกให้อัตโนมัติ ดูรูปแบบใน [index.d.ts](index.d.ts)
`approved_external` เป็นการประกาศของ caller ไม่ใช่การรับรองทางการแพทย์จาก Engine

ตัวอย่างเลขที่คำนวณได้จาก **ข้อมูลจำลอง** ทั้ง10กลุ่มอยู่ [REPORT.md](REPORT.md)
fixture ใน `tests/fixtures.mjs` ไม่ใช่ตารางสุขภาพ และจะถูกกันจาก eligibility รางวัล

## ส่วนประกอบ

| ไฟล์/โฟลเดอร์ | หน้าที่ |
|---|---|
| `index.mjs` | ประกอบแผน, audit, review โดยไม่แก้สูตร |
| `references/` | BMI/muscle ตามต้นฉบับ และ interface โหลด BF ที่องค์กรเลือก |
| `calculators/` | สูตร Weight/BMI/Fat/Muscle ล้วน |
| `classifiers/` | Age Group/Goal Mode |
| `validation/` | Input, composition, measurement, anomaly และ review |
| `scoring/` | Progress, weighted score, median final, eligibility |
| `milestones.mjs` | Day30/60/90/120/150 และ interface curve |
| `index.d.ts` | Types และ Growth Reference interface สำหรับ youth |
| `tests/`, `scripts/` | Unit/grid tests และ deterministic simulation |

อายุต่ำกว่า20จะหยุดรอ youth policy ไม่มี adult fallback แม้ส่ง adult table มา
เป้าทั้งสี่ใช้ precision จริง BMIคำนวณจากน้ำหนักและส่วนสูงเสมอ ปัดเศษเฉพาะตอนแสดงผล
ถ้ามีส่วนสูงจริงจะใช้แทนBMIที่กรอก และบันทึกทั้งค่าเดิมกับค่าที่คำนวณได้

## คะแนนและผลวัดท้ายเกม

ใช้ `scoreProgress(plan, actual)` สำหรับคะแนนพัฒนาการ ก่อนคิดรางวัลให้เรียก
`aggregateFinal(plan, history)` และคำนวณคะแนนจาก `final.actual` อีกครั้ง
จึงส่งทั้งคู่ให้ `rewardEligibility` ผล final ผูกกับ snapshot ของแผนเดียวกัน
และคะแนนต้องตรงกับค่าท้ายเกม การ bind นี้ไม่ใช่ลายเซ็นเข้ารหัสหรือระบบป้องกันโกงฝั่งเซิร์ฟเวอร์

ผล eligibility ไม่ออกของรางวัล; `production_ready` ยังเป็นfalse และ `award_issued` เป็นfalse
เพราะยังไม่มี integration/การรับรองข้อมูลจริง/นโยบายสุดท้ายที่ตรวจเสร็จ
ตาราง synthetic, pending measurements, ข้อมูลขัดกัน, plan/scoreที่ต้อง review
หรือผลวันท้ายไม่ครบ จะไม่ผ่าน eligibility

ธง review ของผู้สูงอายุ/atypicalBMI ใช้ `reviewGoalPlan` พร้อมผู้ตรวจ เหตุผล เวลาและ issues
ที่แก้แล้วได้ โดย targets เดิมไม่เปลี่ยน เคสกล้ามเกิน lean mass ห้าม waive
metadata review ต้องมาจากผู้ตรวจที่ serverอนุญาตในระบบจริง ไม่ใช่ให้ผู้เล่นเซ็นยืนยันเอง

Final default3วันต่างกันในDay145–150; medianรายวันแล้วmedianระหว่างวัน
เพื่อไม่ให้การวัดซ้ำวันเดียวครอบงำค่า นโยบายเสริมนี้, taperคะแนนmaintain,
thresholdflag และเกณฑ์review ระบุแยกใน [REPORT.md](REPORT.md) ให้เลือกก่อน production
สูตรเป้าหมายและน้ำหนักคะแนนตามต้นฉบับยังเหมือนเดิม

## ข้อจำกัดที่ต้องตัดสินใจก่อนใช้จริง

- ไม่มี BF table หรือ muscle definition จริง จึงยังสร้างแผนสุขภาพจริงไม่ได้
- ไม่มี implementation/nโยบายเป้าหมาย youth; มี interface เท่านั้น
- สูตรเดิมมี discontinuities; ค่า Fat/Weight อาจขยับเข้าใกล้แต่ยังไม่ถึง reference zone
- Simulation ไม่พิสูจน์ความปลอดภัย ความเป็นไปได้150วัน หรือความยากเท่ากันของทุกคน
- ต้องมีนโยบายผู้สูงอายุ/ภาวะสุขภาพเฉพาะ และชุดข้อมูลเครื่องวัดจริง
- Types เป็น declarations ที่ให้ไว้; ยังไม่ได้ตรวจด้วย TypeScript compiler ในเครื่องนี้
- ก่อนรางวัลต้องตรวจตัวตน/เวลาDay150/สิทธิ์review/ข้อมูลเริ่มต้นบน server; โมดูลล้วนไม่ทำแทน

กฎต้นฉบับเก็บที่ [ORIGINAL_REQUIREMENTS.txt](ORIGINAL_REQUIREMENTS.txt)
การวิเคราะห์สูตรและแหล่งอ้างอิงอยู่ [FORMULA_REVIEW.md](FORMULA_REVIEW.md)
