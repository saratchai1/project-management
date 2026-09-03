(() => {
  'use strict';

  const VERSION = '20260903-2';
  const APP_PARTS = ['app.bundle-01.b64', 'app.bundle-02.b64', 'app.bundle-03.b64'];
  const STYLE_PARTS = ['styles.bundle-01.b64'];

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
    const [styleSource, appSource] = await Promise.all([
      gunzipText(styleArchive),
      gunzipText(appArchive)
    ]);

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
