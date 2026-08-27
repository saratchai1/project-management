# Work Progress Monitor — ปีที่ 2 / ปีที่ 3

Web app แยกจาก dashboard หลัก ใช้เฉพาะ tab **ปีที่ 2** และ **ปีที่ 3** จากไฟล์ `ข้อมูลการ Monitor ความก้าวหน้าโครงการฯ งานและเ.xlsx` เพื่อให้ทีมติดตามงานรายแปลงและรายงวด

## สิ่งที่ dashboard ตอบ

- แปลงไหนช้ากว่าแผนและควรเร่งก่อน
- Plan / Progress / Gap ของแต่ละแปลง
- งวดไหน Overdue, Delayed, In progress, Not started หรือ Complete
- จังหวัดไหนมีสัดส่วนแปลงที่ต้องเร่งสูง
- Drill-down รายแปลงเพื่อดูทุกงวดและสถานะ

## Snapshot จากไฟล์

### ปีที่ 2
- 151 แปลง
- 460 งวด
- ทุกแปลงและทุกงวดมีสถานะ Complete

### ปีที่ 3
- 151 แปลง
- Plan 39.45%
- Progress 26.56%
- 81 แปลงล่าช้า: 44 วิกฤต + 37 เสี่ยงสูง
- 34 แปลงตามแผน
- 36 แปลงยังไม่ถึงช่วงงานตามแผน
- 449 งวด: 64 Complete, 9 Overdue, 73 Delayed, 6 In progress, 297 Not started

## Risk rule

- **วิกฤต:** Gap ≥ 25 percentage points หรือช้า ≥ 90 วัน
- **เสี่ยงสูง:** Gap ≥ 10 จุด หรือช้า ≥ 30 วัน
- **เฝ้าระวัง:** Gap > 2 จุด หรือช้า > 7 วัน
- **ตามแผน:** ไม่เข้าเกณฑ์ข้างต้นและเริ่มงานแล้ว
- **ยังไม่ถึงแผน:** Status N และ Plan = 0
- **ปิดงานแล้ว:** Status C

ค่า Gap/Delay ใช้ค่าที่บันทึกอยู่ในไฟล์ ไม่ได้คำนวณใหม่จากวันที่เปิดเว็บ

## Data privacy

ไม่ commit Excel ต้นฉบับ และไม่เผยคอลัมน์ `Assigned to`/รายชื่อบุคคลใน public dataset. Dataset สำหรับเว็บเก็บเฉพาะข้อมูลระดับแปลงและงวดที่จำเป็นต่อการติดตามงาน

## URL

เมื่อ GitHub Pages deploy แล้ว:

`https://saratchai1.github.io/project-management/work-monitor/`
