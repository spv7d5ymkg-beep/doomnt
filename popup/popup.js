// 開關存在 chrome.storage.local，4chan 的 content script 會即時跟著改
const box = document.getElementById("fourchan");
chrome.storage.local.get({ fourchan: true }, ({ fourchan }) => {
  box.checked = fourchan;
});
box.addEventListener("change", () => {
  chrome.storage.local.set({ fourchan: box.checked });
});
