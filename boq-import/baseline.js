/* Public aggregate BOQ only. No voucher IDs, remarks, or user workbook bytes. */
(() => {
  'use strict';
  window.BOQ_BASELINE_READY = window.BOQ_BASELINE
    ? Promise.resolve(window.BOQ_BASELINE)
    : fetch('../boq/finance-data.json', {cache:'no-store'}).then(async response => {
        if (!response.ok) throw Error('โหลดฐาน BOQ ไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่');
        const data = await response.json();
        if (!Array.isArray(data.plots) || !Array.isArray(data.portfolios) || !Array.isArray(data.projectCodes))
          throw Error('รูปแบบฐาน BOQ ไม่ถูกต้อง');
        window.BOQ_BASELINE = data;
        return data;
      });
  // The upload handler surfaces errors; never create an unhandled rejection on startup.
  window.BOQ_BASELINE_READY.catch(() => {});
})();
