# Contract Submission Monitor

Static dashboard แยกใหม่สำหรับติดตามการส่งงานจาก 3 Excel sources:

- ข้อมูลการดำเนินงานโครงการปลูกป่า 2566 ปีที่ 1
- ข้อมูลการดำเนินงานโครงการปลูกป่า 2565 ปีที่ 2
- ข้อมูลการดำเนินงานโครงการปลูกป่า 2565 ปีที่ 3

## Contract hierarchy

`TC (Owner) → ROK (Main contractor) → ผรม. (Subcontractor)`

Monitoring layer ของ dashboard นี้คือ `ROK-ผรม.`

## Core rule

ถ้า column `ผรม. ส่งงานวันที่` มี **วันที่จริง** ให้ถือว่าส่งงานงวดนั้นแล้ว

- ข้อความ `ชะลอการดำเนินงาน` / `ยุติการดำเนินงาน` ไม่ถูกนับเป็นวันที่ส่งงาน
- Blank ในงวดที่คาดหวัง = ยังไม่ส่ง
- Blank ที่อยู่นอกจำนวนงวดตามกลุ่มสัญญา = N/A
- วันที่หลัง snapshot date จะแสดงเป็น Data Quality warning แต่ยังถือว่า “มีวันที่” ตาม core rule

## Privacy / source handling

Raw Excel files ไม่ถูก commit เข้า repository นี้. `data.js` เป็น plot-level snapshot ที่เก็บเฉพาะ field ที่ dashboard ต้องใช้.

ชื่อผู้รับเหมาช่วงรายบริษัทไม่ได้อยู่ใน 3 source files จึงไม่เดาชื่อบริษัทจากคอลัมน์ `บริษัท`.
