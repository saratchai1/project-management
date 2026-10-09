# BOQ Excel Workspace — ส่งต่องานให้ทีม

เว็บใช้งาน: https://saratchai1.github.io/project-management/boq-import/

## พฤติกรรมที่ต้องรักษา

เปิดครั้งแรกไม่มีกราฟ อัปโหลด XLSX แล้วอ่าน/รวมข้อมูลและแสดง Dashboard อัตโนมัติ ไม่ถาม Worksheet, Mapping หรือปีงานก่อนสร้างกราฟ มุมขวาบนแสดง **จัดทำเมื่อ** ซึ่งเป็นเวลาสร้างผลสำเร็จ (Asia/Bangkok, พ.ศ.) ไม่ใช่วันที่สร้างไฟล์ต้นฉบับ

อัปโหลดเพิ่มได้ ส่วนที่ทับกันใช้ไฟล์ที่อัปโหลดทีหลัง ไม่บวกซ้ำ รายการอื่นคงอยู่ เลือกหลายไฟล์จะประมวลผลตามลำดับที่ browser ส่งมา ถ้าไฟล์ใดในรอบล้มเหลว ทั้งรอบไม่แทนที่ผลก่อนหน้า

**เซฟผล** เป็นการบันทึกโดยผู้ใช้เท่านั้น เก็บข้อมูลรวมและตัวกรองใน IndexedDB ของ browser นี้ มี localStorage fallback ไม่ซิงก์ข้ามเครื่อง/บัญชี ไม่เก็บอัตโนมัติเมื่อ upload หรือเปลี่ยนตัวกรอง **Reset** บันทึก empty marker และล้างผลปัจจุบัน เพื่อไม่คืนผลเก่าในครั้งหน้า ปุ่ม **ล้างตัวกรอง** ไม่ใช่ Reset ข้อมูล

สำเนา HTML ที่ดาวน์โหลดจะรวมโค้ด รูปแบบ ฐาน BOQ และผลที่ผู้ใช้เลือกไว้สำหรับเปิดออฟไลน์ สำเนานี้มีข้อมูลของผู้ใช้ ต้องจัดเก็บ/ส่งต่อเป็นเอกสารภายใน ไม่ commit กลับ public GitHub

## ไฟล์ที่แก้ต่อ

| ไฟล์ | หน้าที่ |
|---|---|
| `workspace.html` | หน้าเว็บหลักและปุ่ม Upload / Save / Reset |
| `workspace.css` | รูปแบบหน้าอัปโหลด ใช้ `../boq/styles.css` ร่วมกับ Dashboard เดิม |
| `xlsx-reader.js` | อ่าน ZIP/XML XLSX ใน browser ไม่ใช้ CDN และไม่รันสูตร/แมโคร |
| `erp-adapter.js` | ตรวจโครงสร้าง ERP, จับคู่รายการ, latest-upload-wins, คำนวณยอด |
| `workspace.js` | state, เวลา, upload เพิ่ม, manual save/restore, Reset, HTML export |
| `baseline.js` | โหลด aggregate BOQ ที่เผยแพร่แล้วจาก `../boq/finance-data.json` |
| `build_workspace.py` | สร้าง `dashboard.js` จาก renderer เดิมที่ build/validate แล้ว |
| `tests/workspace.cjs` | ชุดทดสอบข้อมูลจำลอง ไม่ใส่ข้อมูลบริษัท |

`index.html`, `app.js`, `public-preview.js`, `styles.css` เดิมยังเก็บใน source เพื่อไม่กระทบ private ingestion pilot ใน `services/boq_ingest` การ deploy จะ copy `workspace.html` ไปเป็น `index.html` เฉพาะในชุดไฟล์ GitHub Pages จึงใช้ URL เดิมได้ อย่าแก้ `dashboard.js` โดยตรงเพราะเป็น generated output

## เริ่มพัฒนา

ต้องมี Node.js 22+, Python 3 และคำสั่ง `patch` ใช้ macOS/Linux หรือ WSL บน Windows

```sh
git clone https://github.com/saratchai1/project-management.git
cd project-management
node boq/validate-embedded.js
python3 boq-import/build_workspace.py
node boq-import/tests/workspace.cjs
python3 -m http.server 8000
```

เปิด http://localhost:8000/boq-import/workspace.html

คำสั่ง `validate-embedded.js` เดิมสร้าง `boq/finance-data.json` และ patch renderer ตามข้อมูลที่อนุมัติไว้ ต้องใช้อินเทอร์เน็ตเพื่ออ่าน snapshot เดิม และรันจาก checkout สะอาด เพราะ patch เดิมไม่ใช่ idempotent หลังจาก build ครั้งแรก การแก้ workspace ใช้ `python3 boq-import/build_workspace.py` ได้โดยไม่ต้องรัน legacy builder ซ้ำ

## การจับคู่และข้อจำกัดที่สำคัญ

Key รายการซ้ำคือ `(maincode, vchno, glitemno)` ไม่ใช่เลขแถว Excel หรือชื่อไฟล์ เปลี่ยนยอด/วันที่/คำอธิบายในไฟล์หลังจะ replace รายการเดิม มีการตรวจหมวดงาน สัญญา และปีงานก่อนคำนวณ ไม่เดาแบ่งรายการที่ปนหลายปีหรือหลายสัญญา ยอดใช้จำนวนเต็มหน่วยสตางค์จาก debit minus credit

งบ BOQ มาจากฐานเดิมที่อนุมัติแล้ว Excel ที่อัปโหลดใช้ปรับ AP ไม่ใช่แก้งบ BOQ อัตโนมัติ รายการที่ไม่สามารถจัดหมวดหรือผูกสัญญาได้จะหยุดนำเข้าโดยไม่เปลี่ยนผลเดิม

**ความเป็นส่วนตัวของ public deployment:** ไม่ฝังรายการ ERP ดิบจากไฟล์ offline ที่ใช้ส่งงานเข้า GitHub ครั้งแรกให้ผู้ใช้อัปโหลด ERP ฉบับเต็มที่มี AP ย้อนหลังถึง 05/10/2569 ตรงกับฐาน (ไฟล์ TC–ROK 07.10.2569 ที่ใช้ทดสอบ หรือฉบับใหม่ที่ยังมีประวัติเดิมครบ) ตัวอ่านตรวจ historical digest แล้วเก็บ reference rows จากไฟล์ของผู้ใช้ในเครื่อง หลังจากนั้นอัปโหลดไฟล์บางส่วน/ไฟล์แก้ไขได้และใช้ค่าล่าสุดตาม key การเปลี่ยนรุ่นฐานต้องทบทวน REFERENCE และ golden dataset ก่อน ไม่ข้าม digest gate เพื่อให้ไฟล์ผ่าน

ขอบเขต: `.xlsx` 20 MiB ต่อไฟล์, 8 ไฟล์ต่อรอบ, 40 sheets, 1,000,000 เซลล์จริง และ 100,000 แถวข้อมูล ไม่คิดช่องว่างทั้งสี่เหลี่ยมเป็นข้อมูล ไม่รองรับ Excel ใส่รหัสผ่าน/macros/active objects

## Deploy และทดสอบ

ใช้ workflow เดิม `.github/workflows/pages.yml` เมื่อ merge เข้า `main` จะ build/validate ฐานเดิม จากนั้น `python3 boq-import/build_workspace.py --publish-entry` และ deploy ไป URL เดิม ไม่มี backend หรือ API key เพิ่ม

Regression: `node boq-import/tests/workspace.cjs` ครอบคลุม initial import, replace, duplicate, append, revert, zero, invalid first reference, conflict, unknown project และ atomicity

ก่อน release ทดสอบใน Chrome: หน้าแรกว่าง → upload ไฟล์จริง → ดูเวลา → upload ซ้ำ/แก้ยอด → เซฟพร้อมตัวกรอง → ปิดเปิดใหม่ → Reset → เปิดใหม่ว่าง และลองดาวน์โหลด HTML เพื่อเปิดแบบออฟไลน์ ห้าม commit Excel, raw voucher IDs, remarks, browser storage dumps หรือไฟล์ HTML snapshot ส่วนตัว

การทดสอบระหว่างส่งงาน: อ่าน XLSX จริงผ่าน native ZIP/XML decoder ใน Chromium DOM ได้ 5,476 data rows / 3,265 AP; summary ตรงฐาน ไม่บวกซ้ำ; Save/Reset ผ่าน storage-fallback simulation; Node regressions ผ่าน การนำทางเว็บและ file URL ถูกจำกัดในสภาพแวดล้อมทดสอบ จึงไม่อ้างผลดังกล่าวเป็น live-network end-to-end หรือ native IndexedDB persistence test
