# Forest Project Control Dashboard

Dashboard สำหรับติดตามโครงการปลูก/บำรุงป่าที่ดำเนินงานโดย subcontractor โดยเชื่อมข้อมูล **Progress** กับ **ERP/AP** ระดับแปลงและสัญญา

## Dashboard ตอบอะไร

- แปลง/สัญญาไหน **ช้ากว่าแผน** และควรติดตามก่อน
- จากมูลค่าสัญญา 100% ตอนนี้ **Progress งานกี่ %**
- ERP มีรายการปีที่ 3 แล้ว **กี่ % ของสัญญา**
- จุดไหนที่ **ERP นำหน้างาน / ต่ำกว่างาน / ต้องตรวจข้อมูลปี 2/3**
- Drill-down ดู **Plan / Progress / ERP summary** ของแต่ละสัญญา

## Snapshot ปัจจุบัน

ข้อมูลถูกสร้างจาก:

- `Progress TC งาน ปีที่ 3 อัพเดท 18.08.2569.xlsx`
- `Export v_gl_rpt313 (bbb48a) 05.08.2569(1).xlsx`

Raw Excel **ไม่ได้ commit** เข้า repository นี้ เพราะ repository เป็น public. Public dataset เก็บเฉพาะข้อมูลสรุประดับแปลง/สัญญา/AP และไม่เผย Voucher ID หรือ Remark ดิบ.

ตัวเลขหลัก ณ snapshot นี้:

- 151 แปลง
- มูลค่าสัญญารวมประมาณ 54.50 ล้านบาท
- Plan 39.45%
- Progress 26.56%
- มูลค่างานที่ตามแผนไม่ทันประมาณ 7.03 ล้านบาท
- 81 แปลงช้ากว่าแผน
- ERP ระบุรายการ `ปีที่3` ได้ 37 แปลง

## วิธีเปิด

เป็น static web app ไม่มี backend:

```bash
python -m http.server 8000
```

แล้วเปิด `http://localhost:8000`

หรือเปิดผ่าน GitHub Pages ด้วย workflow `.github/workflows/pages.yml`.

## Refresh ข้อมูลเมื่อมี Excel รอบใหม่

ใช้สคริปต์ ETL ที่ใช้ Python standard library เท่านั้น:

```bash
python scripts/build_data.py \
  "/path/to/Progress TC งาน ปีที่ 3 ....xlsx" \
  "/path/to/Export v_gl_rpt313 ....xlsx" \
  --output data/project-data.js
```

สคริปต์จะสร้าง `data/project-data.js` และ `data/plots-*.js` ใหม่ทั้งหมด จากนั้นตรวจ reconciliation ก่อน commit:

```bash
node scripts/validate_dashboard.js
```

GitHub Pages workflow จะรัน validator นี้ก่อน deploy ทุกครั้ง. ไม่ควร commit raw ERP/Progress Excel ขึ้น public repository.

## Logic สำคัญ

### Schedule

ระดับที่นำมารวม KPI คือแถว **Plot** เท่านั้น ไม่รวมแถว parent/งวด/activity ซ้ำอีกครั้ง

- `Schedule Gap (pp) = Plan % - Progress %`
- `Delay Value = max(Plan ฿ - Progress ฿, 0)`
- ลำดับการติดตามใช้ Delay Value เป็นหลัก เพื่อให้แปลงที่ช้าและมีมูลค่าสูงขึ้นก่อน

Risk rule:

- Critical: ช้ากว่า ≥ 25 จุด หรือ ≥ 90 วัน
- High: ช้ากว่า ≥ 10 จุด หรือ ≥ 30 วัน
- Watch: ช้ากว่า > 2 จุด หรือ > 7 วัน
- On track: นอกเหนือจากข้างต้น
- Ahead: Progress นำ Plan > 2 จุด

### Contract mapping

Plot ID รองรับทั้งรูปแบบปกติและ suffix เช่น `14-STC`, `14(1)-STC`, `71-VSD`, `71(1)-VSD`.

ใช้ exact Plot ID เพื่อดึง Contract No., WO และ Vendor จาก ERP จึงไม่เอา plot `(1)` ไปปนกับ plot หลัก.

### ERP / Payment

มุมมองเงินใช้เฉพาะ `module = AP` และ transaction ที่ `remark` มีคำว่า `ปีที่3`.

- `High confidence`: remark ระบุปีที่ 3 และไม่ปนปีที่ 2
- `Mixed`: remark เดียวกันมีทั้งปีที่ 2 + ปีที่ 3 → Dashboard แสดง **range** แทนการเดา allocation
- `No data`: ไม่พบ AP transaction ที่ระบุปีที่ 3

> ตัวเลขนี้คือ AP posting / ERP booked amount จากไฟล์ที่ให้มา ไม่ควรตีความเป็น cash bank clearing จนกว่าจะมีข้อมูลการจ่ายเงินจริงจากระบบการเงิน

## Data quality ที่เจอและจัดการแล้ว

- ERP มี 2 worksheet ที่ข้อมูลเหมือนกันทุกแถว → ใช้ worksheet แรกเพียงชุดเดียว ป้องกัน double count
- Plot ใน Progress 151 รายการสามารถ map ไป ERP เพื่อหา Contract/Vendor ได้ครบ
- รายการที่ปนปี 2/3 ถูกแยกเป็น ambiguous ไม่ถูกบังคับ allocate
- Raw files ถูก `.gitignore` เพื่อป้องกันการเผลอ push ข้อมูลบริษัทขึ้น public repo
- Validator ตรวจจำนวน Plot, Plot ID ซ้ำ และ reconciliation ของ Contract / Plan / Progress ก่อน deploy
