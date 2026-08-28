# Work Progress Monitor — Multi-file Excel

เวอร์ชันแยกจาก `work-monitor-upload/` สำหรับกรณีที่ทีมงานมี Excel หลายไฟล์ เช่น ปี 1 อยู่ไฟล์หนึ่ง และปี 2 อยู่อีกไฟล์หนึ่ง

## ความสามารถ

- เพิ่ม Excel ได้หลายไฟล์พร้อมกัน หรือเพิ่มทีหลังได้
- File Manager แสดงชื่อไฟล์ ปีที่อ่านได้ และจำนวนแปลง
- ลบไฟล์ใดไฟล์หนึ่งออกได้ และ dashboard rebuild ทันที
- ปุ่มปีงานสร้างจากทุกไฟล์ที่ยังอยู่ใน File Manager
- ถ้าปีเดียวกันมี Plot ID ซ้ำข้ามไฟล์ ระบบใช้ข้อมูลจาก **ไฟล์ที่เพิ่มล่าสุด** และแจ้งใน Data Quality
- ไม่มีการ์ด `กำลังอ่าน Excel...`
- หน่วยนับหลักคือ **แปลง**; งวดเป็นรายละเอียด drill-down
- ไม่แสดงจำนวนเงินใน dashboard
- Excel ถูกประมวลผลใน browser และไม่ถูกส่งขึ้น GitHub/server

## URL

`https://saratchai1.github.io/project-management/work-monitor-multifile/`

## Dependency

ใช้ SheetJS `xlsx@0.18.5` จาก jsDelivr และใช้ parser ร่วมกับ `work-monitor-upload/excel-parser.js` เพื่อให้กติกาการอ่าน Excel เหมือนเวอร์ชัน upload เดิม
