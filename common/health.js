// 自我檢查：網站改版後，Doomn't 依賴的元素可能改名或不見，功能就悄悄失效。
// 這份腳本在每個頁面穩定下來後檢查「這一頁該有的東西還在不在、該藏的有沒有露出來」，
// 把結果存在 chrome.storage.local 的 health，工具列小視窗會在每個網站的設定區顯示（popup/popup.js）。
//   health = { youtube: { 檢查名稱: { ok, fails, at } }, instagram: {…}, fourchan: {…} }
// - 每項檢查回傳 true（正常）、false（有問題）或 null（這一頁不適用，不記錄）。
// - fails 是連續失敗的次數；小視窗只在連續失敗 2 次以上才提醒，避免頁面載入慢造成的誤報。
// - 只看 DOM，不碰各網站 content script 的內部狀態，所以那些腳本壞掉時這裡照樣能回報。
// - 資料只存在這台電腦上。
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

  const SETTLE_MS = 7000; // 換頁後等這麼久才檢查
  const RETRY_MS = 3000; // 頁面還在載入（Doomn't 的載入動畫還在）：晚一點再檢查
  const MAX_RETRY = 4;

  const root = document.documentElement;
  const q = (s, r) => [...(r || document).querySelectorAll(s)];
  const vis = (e) =>
    !!e && e.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && e.getBoundingClientRect().width > 0;
  const path = () => location.pathname;

  const CHECKS = {
    youtube() {
      const p = path();
      const watch = p === "/watch";
      const page = document.querySelector("ytd-page-manager > :not([hidden])");
      const inPage = (s) => (page ? q(s, page) : []);
      const items = watch
        ? []
        : inPage("yt-lockup-view-model, ytd-video-renderer, ytd-playlist-video-renderer").filter(vis);
      const enough = items.length >= 5;
      const flexy = document.querySelector("ytd-watch-flexy:not([hidden])");
      const player = flexy && flexy.querySelector("#movie_player");
      const video = player && player.querySelector("video");
      const wide = window.innerWidth >= 1100;
      const special = flexy && (flexy.hasAttribute("fullscreen") || flexy.hasAttribute("theater"));
      const chat = flexy && flexy.querySelector("ytd-live-chat-frame");
      const playlist = root.classList.contains("ytc-playlist");
      let fits = null;
      if (watch && player && video && !document.fullscreenElement) {
        const a = player.getBoundingClientRect();
        const b = video.getBoundingClientRect();
        fits = a.width > 0 ? Math.abs(a.width - b.width) < 3 && Math.abs(a.height - b.height) < 3 : null;
      }
      return {
        // 播放頁：版面元件和「兩欄」標記還在（放大版面的規則靠它）
        ytWatchLayout: !watch ? null : !flexy ? false : !wide || special ? null : flexy.hasAttribute("is-two-columns_"),
        // 播放頁：影片畫面填滿播放器
        ytPlayerFit: fits,
        // 播放頁：旁邊沒有推薦影片
        ytRelated:
          !watch || !flexy || playlist || chat
            ? null
            : !q("#related, #secondary yt-lockup-view-model, #secondary ytd-compact-video-renderer", flexy).some(vis),
        // 直播：聊天室有顯示
        ytLiveChat: !watch || !chat ? null : vis(chat),
        // 清單頁：影片長度有讀到
        ytDuration: !enough ? null : items.filter((i) => i.querySelector("ytc-duration")).length >= items.length / 2,
        // 清單頁：縮圖有藏起來
        ytThumbs: !enough
          ? null
          : !items.some((i) => q("img", i).some((im) => vis(im) && im.getBoundingClientRect().width >= 150)),
        // 所有頁面：沒有 Shorts 露出來
        ytShorts: !q('a[href^="/shorts/"]').some(vis),
        // 首頁：推薦是空的
        ytHome:
          p !== "/"
            ? null
            : !!document.querySelector('ytd-browse[page-subtype="home"]') &&
              !inPage("yt-lockup-view-model, ytd-rich-item-renderer").some(vis),
        // 訂閱內容：分頁按鈕有出現
        ytPager: p !== "/feed/subscriptions" ? null : !!document.querySelector("#ytc-pager"),
      };
    },

    instagram() {
      const p = path();
      const storiesMode = root.classList.contains("igc-stories-only") && p === "/";
      const gridMode = root.classList.contains("igc-grid") && p === "/";
      const hasSidebar = !!document.querySelector('a[href="/explore/"]');
      return {
        // 左側選單：「限時動態」「貼文」兩個按鈕
        igNav: !hasSidebar ? null : q("[data-igc-nav]").length === 2,
        // 首頁：限時動態清單有內容
        igStories: !storiesMode ? null : q("#igc-stories .igc-story").length > 0,
        // 首頁：動態貼文沒有露出來
        igFeedHidden: !storiesMode ? null : !q("main article").some(vis),
        // 貼文模式：格狀版面有貼文
        igGrid: !gridMode ? null : q("#igc-grid .igc-tile").length > 0,
        // 探索頁：貼文牆有藏起來
        igExplore: !/^\/explore\/?$/.test(p) ? null : !q('main a[href*="/p/"], main a[href*="/reel/"]').some(vis),
        // 首頁右側的推薦帳號有找到（視窗太窄時 Instagram 本來就不顯示）
        igSuggest:
          p !== "/" || window.innerWidth < 1200 || !root.classList.contains("igc-hide-suggest") || gridMode
            ? null
            : !!document.querySelector("[data-igc-suggest]"),
      };
    },

    fourchan() {
      if (!root.classList.contains("doomnt-4chan")) return {}; // 過濾關掉了
      const home = /^(www\.)?4chan\.org$/.test(host) && path() === "/";
      const board = /^boards\./.test(host);
      return {
        // 首頁：看板分類有找到，而且有藏起看板
        fcBoards: !home ? null : q("#boards .column > ul").length > 0 && q(".doomnt-hide").length > 0,
        // 首頁：熱門討論串區塊還在
        fcPopular: !home ? null : !!document.querySelector("#popular-threads"),
        // 看板頁：上方的看板列有找到
        fcNav: !board ? null : !!document.querySelector("#boardNavDesktop, .boardList"),
      };
    },
  };

  let dead = false;
  function save(results) {
    const ids = Object.keys(results).filter((k) => results[k] !== null && results[k] !== undefined);
    if (dead || !ids.length) return;
    try {
      chrome.storage.local.get({ health: null }, (r) => {
        if (chrome.runtime.lastError) return;
        const health = r.health && typeof r.health === "object" ? r.health : {};
        const mine = (health[site] = health[site] && typeof health[site] === "object" ? health[site] : {});
        const now = Date.now();
        for (const id of ids) {
          const ok = !!results[id];
          const old = mine[id] || {};
          mine[id] = { ok, fails: ok ? 0 : (old.fails || 0) + 1, at: now };
        }
        chrome.storage.local.set({ health }, () => {
          if (chrome.runtime.lastError) return;
          // 方便確認檢查有在跑：這一頁沒過的檢查名稱（都過了就是空的）
          root.dataset.doomntHealth = ids.filter((id) => !results[id]).join(" ");
        });
      });
    } catch {
      dead = true;
    }
  }

  let timer = 0;
  let checkedHref = null;
  function run(retry) {
    if (dead) return;
    // 分頁在背景時網站不會把內容畫出來，檢查會誤報：等回到前景
    if (document.hidden) return;
    // Doomn't 自己的載入動畫還在：頁面還沒好
    if (document.getElementById("igc-loader") && retry < MAX_RETRY) {
      timer = setTimeout(() => run(retry + 1), RETRY_MS);
      return;
    }
    checkedHref = location.href;
    let results;
    try {
      results = CHECKS[site]();
    } catch (err) {
      console.error("[Doomn't] health", err);
      return;
    }
    save(results);
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => run(0), SETTLE_MS);
  }

  // 整頁載入、站內換頁（網址變了）、回到前景時各檢查一次
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      schedule();
    }
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && checkedHref !== location.href) schedule();
  });
  schedule();
})();
