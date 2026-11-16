// 灰階模式：工具列小視窗裡每個網站各有一個開關（grayYoutube／grayInstagram／grayFourchan，預設關閉）。
// 開啟時在 <html> 加上 doomnt-gray，實際的濾鏡在 common/gray.css。
// chrome.storage 是非同步的，等它回來頁面可能已經先用彩色畫了一格；
// 所以把上次的狀態另外記在這個網站自己的 localStorage，一開始先照它套用，讀到真正的設定後再修正。
(function () {
  const host = location.hostname;
  const key = /(^|\.)youtube\.com$/.test(host)
    ? "grayYoutube"
    : /(^|\.)instagram\.com$/.test(host)
      ? "grayInstagram"
      : /(^|\.)4chan(nel)?\.org$/.test(host)
        ? "grayFourchan"
        : null;
  if (!key) return;
  const LOCAL_KEY = "doomntGray";
  function apply(on) {
    on = !!on;
    const root = document.documentElement;
    if (root.classList.contains("doomnt-gray") !== on) root.classList.toggle("doomnt-gray", on);
    try {
      if (on) localStorage.setItem(LOCAL_KEY, "1");
      else localStorage.removeItem(LOCAL_KEY);
    } catch {}
  }
  try {
    if (localStorage.getItem(LOCAL_KEY)) document.documentElement.classList.add("doomnt-gray");
  } catch {}
  try {
    chrome.storage.local.get({ [key]: false }, (r) => {
      if (!chrome.runtime.lastError) apply(r[key]);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[key]) apply(changes[key].newValue);
    });
  } catch {}
})();
