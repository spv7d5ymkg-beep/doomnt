// 開關和語言都存在 chrome.storage.local，content script 會即時跟著改

// 4chan 過濾
const box = document.getElementById("fourchan");
chrome.storage.local.get({ fourchan: true }, ({ fourchan }) => {
  box.checked = fourchan;
});
box.addEventListener("change", () => {
  chrome.storage.local.set({ fourchan: box.checked });
});

// Instagram 首頁右側的推薦帳號（預設藏起來）
const igBox = document.getElementById("igSuggest");
chrome.storage.local.get({ igSuggestHidden: true }, ({ igSuggestHidden }) => {
  igBox.checked = igSuggestHidden;
});
igBox.addEventListener("change", () => {
  chrome.storage.local.set({ igSuggestHidden: igBox.checked });
});

// 語言：選單顯示目前的語言（還沒選過就是跟著瀏覽器的那個），選了就存起來
const select = document.getElementById("lang");
function applyLang(lang) {
  select.value = lang;
  document.documentElement.lang = lang === "en" ? "en" : "zh-Hant-TW";
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = doomntI18n.t(el.dataset.i18n);
  }
}
applyLang(doomntI18n.lang);
doomntI18n.onChange(applyLang);
select.addEventListener("change", () => {
  chrome.storage.local.set({ lang: select.value });
});
