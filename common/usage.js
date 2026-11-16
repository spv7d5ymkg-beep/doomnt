// 使用統計：記錄每個網站每天花了多久、打開幾次，給工具列小視窗顯示（popup/popup.js）。
// 資料只存在這台電腦的 chrome.storage.local（鍵值 usage），不會傳到任何地方。
//   usage = { days: { "2026-11-16": { youtube: { ms, opens }, instagram: {…}, fourchan: {…} } }, last: { youtube: 時間戳, … } }
// - 時間：只算「分頁在前景、而且視窗有焦點」的時候（放在背景播音樂、切到別的視窗都不算）。
//   每秒累計一次，每 FLUSH_MS 或分頁切到背景／關閉時寫進儲存空間。同一時間只有一個分頁有焦點，不會互相覆蓋。
// - 次數：距離上一次使用這個網站超過 SESSION_GAP_MS 才算新的一次（重新整理、站內換頁、短暫切走再回來都不算）。
// - 只留最近 KEEP_DAYS 天。
(function () {
  const host = location.hostname;
  const site = /(^|\.)youtube\.com$/.test(host)
    ? "youtube"
    : /(^|\.)instagram\.com$/.test(host)
      ? "instagram"
      : /(^|\.)4chan(nel)?\.org$/.test(host)
        ? "fourchan"
        : null;
  if (!site) return;

  const FLUSH_MS = 15000;
  const SESSION_GAP_MS = 30000;
  const KEEP_DAYS = 8;
  const dayKey = (d) => {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  };
  const active = () => document.visibilityState === "visible" && document.hasFocus();

  let pending = 0; // 還沒寫進儲存空間的毫秒數
  let lastTick = 0; // 上一次累計的時間（0 = 目前不在使用中）
  let lastFlush = 0;
  let dead = false; // 擴充功能被重新載入後，舊分頁裡的這份腳本不能再用 chrome.*

  function flush() {
    if (dead) return;
    const add = pending;
    pending = 0;
    lastFlush = Date.now();
    try {
      chrome.storage.local.get({ usage: null }, (r) => {
        if (chrome.runtime.lastError) return;
        const usage = r.usage && typeof r.usage === "object" ? r.usage : {};
        const days = usage.days && typeof usage.days === "object" ? usage.days : {};
        const last = usage.last && typeof usage.last === "object" ? usage.last : {};
        const now = Date.now();
        const today = dayKey(new Date(now));
        const day = (days[today] = days[today] || {});
        const s = (day[site] = day[site] || { ms: 0, opens: 0 });
        s.ms = (s.ms || 0) + add;
        if (!last[site] || now - last[site] > SESSION_GAP_MS) s.opens = (s.opens || 0) + 1;
        last[site] = now;
        for (const k of Object.keys(days).sort().slice(0, -KEEP_DAYS)) delete days[k];
        chrome.storage.local.set({ usage: { days, last } });
      });
    } catch {
      dead = true;
    }
  }

  function tick() {
    const now = Date.now();
    if (!active()) {
      if (lastTick) {
        pending += Math.min(now - lastTick, 2000);
        lastTick = 0;
        flush();
      }
      return;
    }
    if (!lastTick) {
      // 剛開始使用（打開分頁、切回來）：馬上記一筆，「次數」才會即時更新
      lastTick = now;
      flush();
      return;
    }
    // 電腦睡眠、計時器被暫停後醒來時，間隔會很長：一次最多算 2 秒
    pending += Math.min(now - lastTick, 2000);
    lastTick = now;
    if (now - lastFlush >= FLUSH_MS) flush();
  }

  setInterval(tick, 1000);
  document.addEventListener("visibilitychange", tick);
  window.addEventListener("focus", tick);
  window.addEventListener("blur", tick);
  window.addEventListener("pagehide", () => {
    if (lastTick) {
      pending += Math.min(Date.now() - lastTick, 2000);
      lastTick = 0;
    }
    if (pending) flush();
  });
  tick();
})();
