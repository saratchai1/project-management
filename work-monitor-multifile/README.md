# Work Progress Monitor — Project Hub + Multi-file Excel

Web app สำหรับแยกการติดตามงานตาม **โครงการ** ก่อนอัปโหลด Excel เช่น โครงการปลูกป่าชายเลนปี 65, โครงการปี 66 หรือโครงการป่าชุมชน

## ลำดับการใช้งาน

1. สร้างหรือเลือกโครงการ
2. เข้า workspace ของโครงการนั้น
3. เพิ่ม Excel ได้หลายไฟล์ เช่น ปี 1 แยกไฟล์กับปี 2
4. ดู dashboard, เพิ่ม/ลบไฟล์ หรือสลับกลับไปโครงการอื่น

## การแยกข้อมูล

- แต่ละโครงการมี dashboard และ File Manager ของตัวเอง
- Excel ของโครงการหนึ่งไม่ถูกรวมกับอีกโครงการ
- สลับโครงการแล้วไฟล์ที่เลือกไว้ยังอยู่ ตราบใดที่ยังไม่ Refresh หรือปิดแท็บ
- ลบโครงการจะนำ workspace และไฟล์ที่เลือกไว้ของโครงการนั้นออกจากหน้าเว็บ
- รายชื่อและรายละเอียดโครงการถูกบันทึกใน `localStorage` ของ browser
- เนื่องจากข้อจำกัดด้านความเป็นส่วนตัว ตัว Excel ไม่ถูกเก็บถาวร หลัง Refresh ต้องเลือก Excel ใหม่

## ความสามารถภายในแต่ละโครงการ

- เพิ่ม Excel ได้หลายไฟล์พร้อมกัน หรือเพิ่มทีหลัง
- ลบไฟล์ใดไฟล์หนึ่งและ rebuild dashboard อัตโนมัติ
- ปุ่มปีงานสร้างจากทุกไฟล์ในโครงการนั้น
- ถ้าปีเดียวกันมี Plot ID ซ้ำข้ามไฟล์ ใช้ข้อมูลจากไฟล์ที่เพิ่มล่าสุดและแจ้งใน Data Quality
- Risk Distribution, Action Queue, จังหวัดที่ต้องจับตา และตารางติดตามรายแปลง
- หน่วยนับหลักคือ **แปลง**; งวดใช้เป็นรายละเอียด drill-down
- ไม่แสดงจำนวนเงิน
- Excel ประมวลผลใน browser และไม่ถูกส่งขึ้น GitHub/server

## โครงสร้าง

- `index.html` — Project Hub สำหรับสร้าง/เลือก/แก้ไข/ลบโครงการ
- `project-shell.js` / `project-shell.css` — จัดการ project workspace
- `dashboard.html` — dashboard แบบ Multi-file ที่เปิดแยกหนึ่ง instance ต่อหนึ่งโครงการ
- `app.js` — logic dashboard ภายในโครงการ

## URL

`https://saratchai1.github.io/project-management/work-monitor-multifile/`

## Dependency

ใช้ SheetJS `xlsx@0.18.5` จาก jsDelivr และใช้ parser ร่วมกับ `work-monitor-upload/excel-parser.js`
