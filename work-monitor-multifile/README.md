# Work Progress Monitor — Project Hub / Multi-file

เวอร์ชัน `work-monitor-multifile/` แยกข้อมูลตาม **โครงการ** ก่อนเข้าสู่ Progress Dashboard

## Workflow

1. สร้างหรือเลือกโครงการ
2. ระบบเปิด Pop-up รายละเอียดโครงการ
3. เพิ่ม Excel Progress และ/หรือแนบเอกสารของโครงการ
4. เปิด Dashboard และเลือกปีงานเพื่อดู Plan / Progress / Risk รายแปลง

## ความสามารถ

- Project filter ก่อนดู Progress
- รายการโครงการและตัวเลือกสลับโครงการ
- Pop-up รายละเอียดโครงการ แสดงจำนวนไฟล์ ปีงาน แปลง และเอกสารแนบ
- Dashboard มาตรฐานเดียวกันทุกโครงการ แต่แยกข้อมูลออกจากกันด้วย iframe ต่อโครงการ
- รองรับ Excel หลายไฟล์ต่อโครงการ เช่น ปีที่ 1 และปีที่ 2 แยกกัน
- เพิ่ม/ลบ Excel ภายใน Dashboard ของโครงการนั้น
- แนบเอกสารทั่วไปต่อโครงการ พร้อมเปิด/ดาวน์โหลดและลบ
- Year tabs, Risk Distribution, Action Queue, จังหวัดที่ต้องจับตา และตารางติดตามรายแปลง

## Data privacy / persistence

- ชื่อและคำอธิบายโครงการถูกบันทึกใน `localStorage` ของ browser
- Excel และเอกสารแนบอ่านจากเครื่องผู้ใช้และอยู่ในหน่วยความจำของแท็บปัจจุบันเท่านั้น
- ไฟล์ไม่ถูกส่งขึ้น GitHub หรือ server
- เมื่อ Refresh หรือปิดแท็บ ต้องเลือก Excel และเอกสารใหม่

## URL

`https://saratchai1.github.io/project-management/work-monitor-multifile/`
