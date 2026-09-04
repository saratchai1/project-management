(() => {
  'use strict';

  const VERSION = '20260904-1';
  const APP_PARTS = ['app.bundle-01.b64', 'app.bundle-02a.b64', 'app.bundle-02b.b64', 'app.bundle-03.b64'];
  const STYLE_PARTS = ['styles.bundle-01.b64'];

  function replaceRequired(source, before, after, label) {
    const index = source.indexOf(before);
    if (index < 0) throw new Error(`โค้ดส่วน ${label} ไม่ตรงกับเวอร์ชันที่คาดไว้ กรุณารีเฟรชหน้า`);
    return source.slice(0, index) + after + source.slice(index + before.length);
  }

  function patchAppSource(input) {
    let source = input;
    const patches = [
      [
        String.raw`if (plot && /^\s*\d+\s*-\s*[a-zก-๙0-9]+/i.test(description)) {`,
        String.raw`if (plot && /^\s*\d+(?:\(\d+\))?\s*-\s*[a-zก-๙0-9]+/i.test(description)) {`,
        'รหัสแปลงแบบวงเล็บใน Progress'
      ],
      [
        String.raw`const installment = extractPaidInstallment(remark);
      const operationYear = extractOperationYear(allText);`,
        String.raw`const paymentContext = extractPaymentContext(allText);
      const operationYear = paymentContext.operationYear;
      const installments = paymentContext.installments;
      const installment = installments[0] || '';`,
        'ปีและงวดจาก ERP'
      ],
      [
        String.raw`operationYear,
        installment,
        amount,`,
        String.raw`operationYear,
        installment,
        installments,
        amount,`,
        'รายการหลายงวดใน ERP'
      ],
      [
        String.raw`if (transaction.installment) {
        group.installmentNet.set(transaction.installment, (group.installmentNet.get(transaction.installment) || 0) + transaction.amount);
      }`,
        String.raw`const installments = transaction.installments?.length
        ? transaction.installments
        : transaction.installment ? [transaction.installment] : [];
      installments.forEach((installment) => {
        group.installmentNet.set(installment, (group.installmentNet.get(installment) || 0) + transaction.amount);
      });`,
        'การรวมหลายงวดจาก ERP'
      ],
      [
        String.raw`return cleaned.replace(/-\d+$/, '');`,
        String.raw`return cleaned.replace(/-\d+(?:\(\d+\))?$/, '');`,
        'รหัสโครงการที่มี suffix วงเล็บ'
      ],
      [
        String.raw`const match = cleaned.match(/\b(\d+\s*-\s*[A-Z]{2,}[A-Z0-9]*)\b/);`,
        String.raw`const match = cleaned.match(/(?<![A-Z0-9])(\d+(?:\(\d+\))?\s*-\s*[A-Z]{2,}[A-Z0-9]*)(?![A-Z0-9])/);`,
        'รหัสแปลง STC/VSD แบบวงเล็บ'
      ],
      [
        String.raw`  function extractPaidInstallment(value) {
    const source = toArabicDigits(text(value));
    let match = source.match(/งวด(?:งาน|เงิน)?\s*(?:ที่)?\s*(\d{1,2})/i);
    if (match) return String(Number(match[1]));
    if (/เบิก|ค่าจ้าง|ปลูก|บำรุง/i.test(source)) {
      match = source.match(/ครั้ง(?:ที่)?\s*(\d{1,2})/i);
      if (match) return String(Number(match[1]));
    }
    return '';
  }`,
        String.raw`  function extractPaymentContext(value) {
    const source = toArabicDigits(text(value));
    const yearMatches = [...source.matchAll(/ปีที่\s*(\d{1,2})/ig)];
    let operationYear = null;
    let installmentSource = source;

    if (yearMatches.length) {
      const selectedYear = yearMatches.at(-1);
      operationYear = Number(selectedYear[1]);
      installmentSource = source.slice(selectedYear.index ?? 0);
    }

    return { operationYear, installments: extractPaidInstallments(installmentSource) };
  }

  function extractPaidInstallments(value) {
    const source = toArabicDigits(text(value));
    const installments = [];
    const marker = /งวด(?:งาน|เงิน)?\s*(?:ที่)?\s*(\d{1,2})/ig;
    let match;

    while ((match = marker.exec(source))) {
      installments.push(String(Number(match[1])));
      const tail = source.slice(marker.lastIndex, marker.lastIndex + 48);
      const continuation = tail.match(/^\s*((?:(?:,|และ|\/|&|-|ถึง)\s*(?:งวด(?:งาน|เงิน)?\s*(?:ที่)?\s*)?\d{1,2})+)/i);
      if (continuation) {
        const extra = [...continuation[1].matchAll(/\d{1,2}/g)].map((item) => String(Number(item[0])));
        installments.push(...extra);
      }
    }

    if (!installments.length && /เบิก|ค่าจ้าง|ปลูก|บำรุง/i.test(source)) {
      const fallback = source.match(/ครั้ง(?:ที่)?\s*(\d{1,2})/i);
      if (fallback) installments.push(String(Number(fallback[1])));
    }
    return uniqueInstallments(installments);
  }

  function extractPaidInstallment(value) {
    return extractPaidInstallments(value)[0] || '';
  }`,
        'การอ่านหลายงวดและข้อความหลายปี'
      ],
      [
        String.raw`category: inferCategory(allText, projectCode, rawSheet.fileName),`,
        String.raw`category: inferCategory(projectDescription, projectCode, rawSheet.fileName),`,
        'ไม่ใช้เลข voucher/WO เป็นปีประเภทโครงการ'
      ]
    ];

    patches.forEach(([before, after, label]) => {
      source = replaceRequired(source, before, after, label);
    });

    const categoryStart = source.indexOf("  function inferCategory(value, projectCode = '', fileName = '') {");
    const categoryEnd = source.indexOf('\n\n  function inferTokenType', categoryStart);
    if (categoryStart < 0 || categoryEnd < 0) {
      throw new Error('โค้ดส่วนประเภทโครงการไม่ตรงกับเวอร์ชันที่คาดไว้ กรุณารีเฟรชหน้า');
    }
    const categorySource = String.raw`  function inferCategory(value, projectCode = '', fileName = '') {
    const source = String(value || '') + ' ' + String(projectCode || '') + ' ' + String(fileName || '');
    const normalized = toArabicDigits(source);
    const projectText = toArabicDigits(String(value || ''));
    const isCommunity = /ชุมชน|community/i.test(normalized);
    const isExternal = !isCommunity && /บุคคลภายนอก|ภายนอก|external|\b(?:STC|VSD)\b/i.test(normalized);
    const projectKey = baseProjectCode(projectCode) || cleanProjectCode(projectCode);
    const knownProjectYears = {
      TCGMCR6508: '2565',
      TCGMCR6607: '2565',
      TCGMCR6609: '2566',
      TCGMCR67003: '2566',
      TCGMCR67004: '2566'
    };
    let year = '';

    const explicitFullYear = projectText.match(/(?:ประจำปี(?:\s*พ\.?\s*ศ\.?)?|พ\.?\s*ศ\.?)\s*(25\d{2})(?!\d)/i);
    const explicitShortYear = projectText.match(/\(\s*ปี\s*(\d{2})\s*\)/i);
    if (explicitFullYear) year = explicitFullYear[1];
    else if (explicitShortYear) year = '25' + explicitShortYear[1];
    else if (knownProjectYears[projectKey]) year = knownProjectYears[projectKey];
    else {
      const codeYear = cleanProjectCode(projectCode).match(/TCG[A-Z]+(6\d)/);
      if (codeYear) year = '25' + codeYear[1];
      else {
        const plainYear = projectText.match(/(?:^|[\s(])ปี\s*(25\d{2})(?!\d)/i);
        if (plainYear) year = plainYear[1];
      }
    }

    if (/ปลูกป่า|คาร์บอน|mangrove|forest/i.test(normalized) || /^TCG/i.test(projectCode)) {
      const audience = isCommunity ? ' (สำหรับชุมชน)' : isExternal ? ' (สำหรับบุคคลภายนอก)' : '';
      return 'โครงการปลูกป่าชายเลน เพื่อประโยชน์จากคาร์บอนเครดิต' + audience + (year ? ' ปี ' + year : '');
    }
    return '';
  }`;
    source = source.slice(0, categoryStart) + categorySource + source.slice(categoryEnd);
    return source;
  }

  async function fetchJoined(paths) {
    const parts = await Promise.all(paths.map(async (path) => {
      const response = await fetch(`${path}?v=${VERSION}`, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`โหลด ${path} ไม่สำเร็จ (${response.status})`);
      return (await response.text()).trim();
    }));
    return parts.join('');
  }

  function decodeBase64(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  async function gunzipText(value) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('เบราว์เซอร์นี้ไม่รองรับการเปิดชุดข้อมูลของแอป กรุณาใช้ Chrome, Edge, Firefox หรือ Safari เวอร์ชันปัจจุบัน');
    }
    const input = new Blob([decodeBase64(value)]).stream();
    const output = input.pipeThrough(new DecompressionStream('gzip'));
    return new Response(output).text();
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function showError(error) {
    console.error('BOQ app failed to start:', error);
    document.documentElement.classList.remove('app-loading');
    const main = document.querySelector('main');
    if (!main) return;
    main.innerHTML = `<section class="loader-error"><strong>เปิดระบบรายงานไม่สำเร็จ</strong><p>${escapeHtml(error?.message || error)}</p><button type="button" onclick="location.reload()">ลองโหลดใหม่</button></section>`;
  }

  async function boot() {
    document.documentElement.classList.add('app-loading');
    const [styleArchive, appArchive] = await Promise.all([
      fetchJoined(STYLE_PARTS),
      fetchJoined(APP_PARTS)
    ]);
    const [styleSource, originalAppSource] = await Promise.all([
      gunzipText(styleArchive),
      gunzipText(appArchive)
    ]);
    const appSource = patchAppSource(originalAppSource);

    const style = document.createElement('style');
    style.id = 'boq-dashboard-styles';
    style.textContent = styleSource;
    document.head.appendChild(style);

    const sourceUrl = URL.createObjectURL(new Blob([appSource], { type: 'text/javascript' }));
    const script = document.createElement('script');
    script.src = sourceUrl;
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('เริ่มระบบประมวลผล Excel ไม่สำเร็จ'));
      document.body.appendChild(script);
    });
    URL.revokeObjectURL(sourceUrl);
    document.documentElement.classList.remove('app-loading');
  }

  boot().catch(showError);
})();
