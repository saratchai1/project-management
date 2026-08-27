# Work Progress Monitor — Upload Excel

Web app แบบ reusable สำหรับทีมงานอัปโหลด Excel Monitor รอบใหม่ (ปี 4, ปี 5, …) แล้วสร้าง dashboard ใน browser โดยไม่ต้อง regenerate dataset หรือแก้ source code ทุกปี

## หลักการ

- ประมวลผล Excel บนเครื่องผู้ใช้ใน browser
- ไม่ upload raw Excel ขึ้น GitHub/server
- ตรวจหา sheet ปีงานอัตโนมัติจากชื่อ sheet เช่น `ปีที่ 4` หรือข้อความหัวโครงการ
- ต้องมี header หลัก: `Description`, `WBS No`, `Plan (%)`, `Progress(%)`, `Status`
- หน่วยนับหลักคือ **แปลง**; งวดเป็นรายละเอียด drill-down
- ไม่แสดงจำนวนเงินใน dashboard

## Dashboard

- Dynamic year tabs จากไฟล์ที่อัปโหลด
- KPI: จำนวนแปลง, Plan, Progress, Gap, แปลงต้องเร่ง, แปลงติดขัด
- Interactive Risk Distribution donut
  - Hover แสดงรายชื่อแปลง
  - Click สถานะ → ไป `ติดตามงาน` พร้อม filter
- Action Queue
- จังหวัดที่ต้องจับตา
- ตารางติดตามรายแปลง + drill-down งวด
- Data Quality report แสดง sheet ที่อ่านได้/ข้ามและ warning
- Export CSV (ไม่มีจำนวนเงิน)

## URL

เมื่อ GitHub Pages deploy:

`https://saratchai1.github.io/project-management/work-monitor-upload/`

## Dependency

ใช้ SheetJS `xlsx@0.18.5` จาก jsDelivr เพื่ออ่าน Excel ใน browser. ไฟล์ Excel ไม่ถูกส่งไปยัง CDN; CDN ใช้เฉพาะโหลด JavaScript library.
