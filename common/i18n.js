// 介面語言（繁體中文 / English）：所有 content script 和彈出視窗共用。
// - 使用者在彈出視窗選的語言存在 chrome.storage.local 的 lang；還沒選過就跟著瀏覽器語言（中文 → 中文，其他 → 英文）
// - <html data-doomnt-lang="zh|en">：讓 CSS 裡的文字（::before 的 content）也能跟著切換
// - 在彈出視窗換語言時，已開著的分頁馬上跟著換（onChange），不用重新整理
var doomntI18n = (() => {
  const STRINGS = {
    zh: {
      prev: "← 上一頁",
      next: "下一頁 →",
      page: "第 {n} 頁",
      noMoreVideos: "沒有更多影片了",
      noMorePosts: "沒有更多貼文了",
      loading: "載入中…",
      stories: "限時動態",
      posts: "貼文",
      // 彈出視窗
      language: "語言",
      options: "選項",
      fourchanTitle: "4chan 過濾",
      fourchanDesc: "藏起成人看板和 Misc（/pol/ 除外），熱門討論串只顯示 SFW",
      igSuggestTitle: "藏起 Instagram 推薦帳號",
      igSuggestDesc: "首頁右側的推薦帳號和上面你自己的帳號，其餘內容置中",
      igDmTitle: "藏起 Instagram 訊息按鈕",
      igDmDesc: "右下角的「訊息」浮動按鈕",
    },
    en: {
      prev: "← Previous",
      next: "Next →",
      page: "Page {n}",
      noMoreVideos: "No more videos",
      noMorePosts: "No more posts",
      loading: "Loading…",
      stories: "Stories",
      posts: "Posts",
      language: "Language",
      options: "Options",
      fourchanTitle: "4chan filter",
      fourchanDesc: "Hides adult boards and Misc (except /pol/); popular threads show SFW only",
      igSuggestTitle: "Hide Instagram suggestions",
      igSuggestDesc: "Hides suggested accounts and your account on the right of the homepage, and centers the rest",
      igDmTitle: "Hide Instagram Messages button",
      igDmDesc: "The floating Messages button in the bottom-right corner",
    },
  };
  const browserLang = /^zh/i.test(navigator.language) ? "zh" : "en";
  let lang = browserLang;
  const listeners = [];

  function mark() {
    if (document.documentElement) document.documentElement.dataset.doomntLang = lang;
  }
  function set(l) {
    l = l === "zh" || l === "en" ? l : browserLang;
    if (l === lang) return;
    lang = l;
    mark();
    for (const f of listeners) {
      try {
        f(lang);
      } catch (err) {
        console.error("[Doomn't]", err);
      }
    }
  }
  mark();
  chrome.storage.local.get({ lang: null }, (r) => set(r.lang));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.lang) set(changes.lang.newValue);
  });

  return {
    get lang() {
      return lang;
    },
    // t("page", { n: 3 }) → 「第 3 頁」/「Page 3」
    t(key, vars) {
      let s = STRINGS[lang][key];
      if (s === undefined) s = STRINGS.zh[key] || key;
      if (vars) for (const k in vars) s = s.replace("{" + k + "}", vars[k]);
      return s;
    },
    onChange(f) {
      listeners.push(f);
    },
  };
})();
