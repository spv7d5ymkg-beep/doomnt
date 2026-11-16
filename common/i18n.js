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
      settings: "設定",
      comingSoon: "即將推出",
      // 自我檢查（common/health.js）
      healthOk: "功能運作正常（已檢查 {n} 項）",
      healthWarn: "{n} 個功能可能失效，網站可能改版了：",
      healthNone: "還沒有檢查紀錄，打開這個網站後就會有",
      ytWatchLayout: "播放頁的放大版面",
      ytPlayerFit: "影片畫面填滿播放器",
      ytRelated: "藏起播放頁旁的推薦影片",
      ytLiveChat: "直播聊天室",
      ytDuration: "清單上的影片長度",
      ytThumbs: "藏起縮圖",
      ytShorts: "藏起 Shorts",
      ytHome: "清空首頁推薦",
      ytPager: "訂閱內容的分頁",
      igNav: "左側的「限時動態／貼文」按鈕",
      igStories: "限時動態清單",
      igFeedHidden: "藏起首頁動態",
      igGrid: "貼文格狀版面",
      igExplore: "藏起探索頁貼文",
      igSuggest: "藏起推薦帳號",
      fcBoards: "藏起首頁的看板",
      fcPopular: "熱門討論串",
      fcNav: "看板列",
      fourchanTitle: "4chan 過濾",
      fourchanDesc: "藏起成人看板和 Misc（/pol/ 除外），熱門討論串只顯示 SFW",
      igSuggestTitle: "藏起 Instagram 推薦帳號",
      igSuggestDesc: "首頁右側的推薦帳號和上面你自己的帳號，其餘內容置中",
      igDmTitle: "藏起 Instagram 訊息按鈕",
      igDmDesc: "右下角的「訊息」浮動按鈕",
      // 使用統計
      today: "今天",
      total: "合計",
      opens: "{n} 次",
      last7: "最近 7 天",
      vsYesterday: "和昨天比",
      same: "和昨天一樣",
      noYesterday: "昨天沒有紀錄",
      hm: "{h} 小時 {m} 分",
      mOnly: "{m} 分鐘",
      lessMin: "不到 1 分鐘",
      none: "還沒用過",
      weekdays: "日一二三四五六",
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
      settings: "Settings",
      comingSoon: "Coming soon",
      healthOk: "Everything is working ({n} checks)",
      healthWarn: "{n} features may be broken; the site may have changed:",
      healthNone: "No checks yet; open this site to run them",
      ytWatchLayout: "Enlarged watch page layout",
      ytPlayerFit: "Video fills the player",
      ytRelated: "Hiding recommended videos on the watch page",
      ytLiveChat: "Live chat",
      ytDuration: "Video length in lists",
      ytThumbs: "Hiding thumbnails",
      ytShorts: "Hiding Shorts",
      ytHome: "Empty home page",
      ytPager: "Subscriptions paging",
      igNav: "Stories / Posts buttons in the sidebar",
      igStories: "Stories list",
      igFeedHidden: "Hiding the home feed",
      igGrid: "Posts grid",
      igExplore: "Hiding Explore posts",
      igSuggest: "Hiding suggested accounts",
      fcBoards: "Hiding boards on the home page",
      fcPopular: "Popular threads",
      fcNav: "Board list",
      fourchanTitle: "4chan filter",
      fourchanDesc: "Hides adult boards and Misc (except /pol/); popular threads show SFW only",
      igSuggestTitle: "Hide Instagram suggestions",
      igSuggestDesc: "Hides suggested accounts and your account on the right of the homepage, and centers the rest",
      igDmTitle: "Hide Instagram Messages button",
      igDmDesc: "The floating Messages button in the bottom-right corner",
      today: "Today",
      total: "Total",
      opens: "{n}×",
      last7: "Last 7 days",
      vsYesterday: "vs yesterday",
      same: "same as yesterday",
      noYesterday: "no data for yesterday",
      hm: "{h}h {m}m",
      mOnly: "{m} min",
      lessMin: "under 1 min",
      none: "not used",
      weekdays: "SMTWTFS",
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
