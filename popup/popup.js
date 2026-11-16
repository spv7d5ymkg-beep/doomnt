// 開關和語言都存在 chrome.storage.local，content script 會即時跟著改

// 4chan 過濾
const box = document.getElementById("fourchan");
chrome.storage.local.get({ fourchan: true }, ({ fourchan }) => {
  box.checked = fourchan;
});
box.addEventListener("change", () => {
  chrome.storage.local.set({ fourchan: box.checked });
});

// Instagram：首頁右側的推薦帳號、右下角的訊息按鈕（預設都藏起來）
for (const [id, key] of [
  ["igSuggest", "igSuggestHidden"],
  ["igDm", "igDmHidden"],
]) {
  const el = document.getElementById(id);
  chrome.storage.local.get({ [key]: true }, (r) => {
    el.checked = r[key];
  });
  el.addEventListener("change", () => {
    chrome.storage.local.set({ [key]: el.checked });
  });
}

// 語言：選單顯示目前的語言（還沒選過就是跟著瀏覽器的那個），選了就存起來
const select = document.getElementById("lang");
function applyLang(lang) {
  select.value = lang;
  document.documentElement.lang = lang === "en" ? "en" : "zh-Hant-TW";
  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = doomntI18n.t(el.dataset.i18n);
  }
}
// ---------- 使用統計（資料由 common/usage.js 記錄） ----------
const SITES = [
  ["youtube", "YouTube"],
  ["instagram", "Instagram"],
  ["fourchan", "4chan"],
];
let usageDays = {};
const dayKey = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
const dayTotal = (key) => SITES.reduce((sum, [id]) => sum + (((usageDays[key] || {})[id] || {}).ms || 0), 0);
function fmt(ms) {
  const t = doomntI18n.t;
  const min = Math.floor(ms / 60000);
  if (min < 1) return t("lessMin");
  if (min < 60) return t("mOnly", { m: min });
  return t("hm", { h: Math.floor(min / 60), m: min % 60 });
}
function renderStats() {
  const t = doomntI18n.t;
  const now = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
  const todayKey = dayKey(days[6]);
  const yesterdayKey = dayKey(days[5]);
  const today = usageDays[todayKey] || {};
  const total = dayTotal(todayKey);

  document.getElementById("totalTime").textContent = total ? fmt(total) : t("none");
  // 和昨天比：差不到 1 分鐘當成一樣
  const delta = document.getElementById("totalDelta");
  delta.className = "stat-delta";
  if (!usageDays[yesterdayKey]) delta.textContent = t("noYesterday");
  else {
    const diff = total - dayTotal(yesterdayKey);
    if (Math.abs(diff) < 60000) delta.textContent = t("same");
    else {
      delta.textContent = (diff > 0 ? "▲ " : "▼ ") + fmt(Math.abs(diff)) + " " + t("vsYesterday");
      delta.classList.add(diff > 0 ? "up" : "down");
    }
  }

  const sites = document.getElementById("sites");
  sites.textContent = "";
  for (const [id, name] of SITES) {
    const s = today[id] || {};
    const cells = [
      ["site", name],
      ["time" + (s.ms ? "" : " unused"), s.ms ? fmt(s.ms) : s.opens ? t("lessMin") : "–"],
      ["opens", t("opens", { n: s.opens || 0 })],
    ];
    for (const [cls, text] of cells) {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = text;
      sites.appendChild(el);
    }
  }

  const week = document.getElementById("week");
  week.textContent = "";
  const totals = days.map((d) => dayTotal(dayKey(d)));
  const max = Math.max(...totals, 60000);
  const names = t("weekdays");
  days.forEach((d, i) => {
    const col = document.createElement("div");
    col.className = "day" + (i === 6 ? " today" : "");
    col.title = d.getMonth() + 1 + "/" + d.getDate() + "：" + (totals[i] ? fmt(totals[i]) : t("none"));
    const track = document.createElement("div");
    track.className = "track";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = Math.round((totals[i] / max) * 100) + "%";
    track.appendChild(bar);
    const label = document.createElement("span");
    label.textContent = names[d.getDay()];
    col.append(track, label);
    week.appendChild(col);
  });
  week.setAttribute(
    "aria-label",
    t("last7") + "：" + days.map((d, i) => d.getMonth() + 1 + "/" + d.getDate() + " " + (totals[i] ? fmt(totals[i]) : t("none"))).join("、")
  );
}
chrome.storage.local.get({ usage: null }, (r) => {
  usageDays = (r.usage && r.usage.days) || {};
  renderStats();
});
// 小視窗開著時，正在用的分頁寫入新的數字就跟著更新
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.usage) return;
  usageDays = (changes.usage.newValue && changes.usage.newValue.days) || {};
  renderStats();
});
doomntI18n.onChange(renderStats);

applyLang(doomntI18n.lang);
doomntI18n.onChange(applyLang);
select.addEventListener("change", () => {
  chrome.storage.local.set({ lang: select.value });
});
