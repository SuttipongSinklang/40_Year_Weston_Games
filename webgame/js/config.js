// Public browser configuration. Never put a service_role key here.
export const SUPABASE_URL = 'https://jlweqxpkqgnjcwcgisfj.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impsd2VxeHBrcWduamN3Y2dpc2ZqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0Mjc5OTUsImV4cCI6MjEwNzAwMzk5NX0.H7jRSwNGhvP5q7x8Xf5PWF31PjTc7Do2kOWJlIMhNJc';

// HR backend (ระบบพนักงาน Weston) — ใช้แบบอ่านอย่างเดียวเพื่อจับคู่ LINE กับพนักงาน
// ผ่านตาราง employee_line_links ข้อมูลเกมยังเก็บบน SUPABASE_URL ข้างบนตามเดิม
export const HR_SUPABASE_URL = 'https://hr.westonsupa.xyz';
export const HR_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzc4ODI1ODEzLCJleHAiOjIwOTQxODU4MTN9.OTkhEbjKX7P7oY9P0xSH0oZYknA22rCuZl3qbTQLG24';

// LIFF ID ของแอป LINE ที่ใช้ลิงก์พนักงาน (ดูได้จาก LINE Developers > LIFF)
// แอป: Weston40Game · Endpoint: https://p.westonsupa.xyz/
// ถ้าเว้นว่าง ระบบจะใช้ ?line_uid=... ที่ LINE bot แนบมากับลิงก์เกมแทน
export const LINE_LIFF_ID = '2011737916-P2L6GQD6';
