// 使用統計：記錄每個網站每天花了多久、打開幾次，給工具列小視窗顯示（popup/popup.js）。
// 資料只存在這台電腦的 chrome.storage.local（鍵值 usage），不會傳到任何地方。
//   usage = { days: { "2026-11-16": { youtube: { ms, opens }, instagram: {…}, fourchan: {…} } }, last: { youtube: 時間戳, … } }
// - 時間：只算「分頁在前景、而且視窗有焦點」的時候（放在背景播音樂、切到別的視窗都不算）。
//   每秒累計一次，每 FLUSH_MS 或分頁切到背景／關閉時寫進儲存空間。同一時間只有一個分頁有焦點，不會互相覆蓋。
//   寫入成功後會在 <html data-doomnt-usage="網站 秒數 次數"> 留下目前的數字。
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

  const FLUSH_MS = 5000;
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

  // 儲存空間裡目前的資料，在記憶體裡留一份（一開始讀一次，之後別的分頁寫入時跟著更新）。
  // 寫入時直接改這一份再整個存回去，不用「先讀再寫」：
  // 先讀再寫要等一次非同步回呼，換頁或關分頁時頁面已經沒了、回呼不會執行，那一段時間就丟了
  // （4chan 每點一個連結都是整頁載入，幾乎每一頁都會丟）
  let usage = null; // null = 還沒讀到
  const norm = (u) => {
    u = u && typeof u === "object" ? u : {};
    return {
      days: u.days && typeof u.days === "object" ? u.days : {},
      last: u.last && typeof u.last === "object" ? u.last : {},
    };
  };
  try {
    chrome.storage.local.get({ usage: null }, (r) => {
      if (chrome.runtime.lastError) return;
      usage = norm(r.usage);
      flush();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.usage) usage = norm(changes.usage.newValue);
    });
  } catch {
    dead = true;
  }

  function flush() {
    if (dead || !usage) return; // 還沒讀到：先累計在 pending，讀到後會再呼叫一次
    const add = pending;
    pending = 0;
    const now = Date.now();
    lastFlush = now;
    const today = dayKey(new Date(now));
    const day = (usage.days[today] = usage.days[today] || {});
    const s = (day[site] = day[site] || { ms: 0, opens: 0 });
    s.ms = (s.ms || 0) + add;
    if (!usage.last[site] || now - usage.last[site] > SESSION_GAP_MS) s.opens = (s.opens || 0) + 1;
    usage.last[site] = now;
    for (const k of Object.keys(usage.days).sort().slice(0, -KEEP_DAYS)) delete usage.days[k];
    try {
      chrome.storage.local.set({ usage }, () => {
        if (chrome.runtime.lastError) return;
        // 寫入成功後標在 <html> 上（今天這個網站的秒數和次數），方便確認計時真的有在運作
        document.documentElement.dataset.doomntUsage = site + " " + Math.round(s.ms / 1000) + "s " + s.opens;
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
