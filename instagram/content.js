(function () {
  const { t } = doomntI18n; // 介面語言（common/i18n.js）
  // 只在文字不同時才改：每次都改會觸發 MutationObserver，又跑一次檢查
  const setText = (el, s) => {
    if (el.textContent !== s) el.textContent = s;
  };

  // ---------- 路徑規則 ----------
  // 單支 Reels（/reels/ID/、/reel/ID/）→ 改用單篇貼文頁 /p/ID/ 開啟：可以看，但不能往下滑
  const SINGLE_REEL_RE = /^\/reels?\/([A-Za-z0-9_-]+)\/?$/;
  // Reels 首頁、音訊頁、個人頁 Reels 分頁 → 導回首頁
  const REELS_BLOCK_RE = /^\/reels?\/?$|^\/reels\/audio\/|^\/[^/]+\/reels\/?$/;
  // 貼文頁（可能出現「更多「某帳號」的貼文」影片牆）
  const POST_PAGE_RE = /^\/(?:[^/]+\/)?(?:p|reel)\/[^/]+/;
  const MORE_POSTS_RE = /^(」的貼文|More posts from)$/;

  // ---------- 動態過濾用的文字 ----------
  const MARKER_RE = /^(沒有其他新動態了|You're all caught up)$/;   // 這個區塊之後全是建議貼文
  const SUG_HEAD_RE = /^(建議貼文|Suggested posts)$/;
  const AD_RE = /^(贊助|Sponsored)$/;

  function findText(root, re) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (re.test(n.textContent.trim())) return n.parentElement;
    }
    return null;
  }

  function hide(el) {
    el.classList.add("igc-hidden");
  }

  // ---------- 首頁動態：移除廣告與建議貼文 ----------
  function filterFeed() {
    // 「追蹤中」動態的貼文不在 <main> 裡，所以不限定 main
    const articles = document.querySelectorAll("article");
    if (!articles.length) return;

    // 1. 所有標示「贊助」的貼文
    for (const a of articles) {
      if (!a.classList.contains("igc-hidden") && findText(a, AD_RE)) hide(a);
    }

    // 2. 「沒有其他新動態了」之後的所有貼文（依文件順序判斷，不依賴巢狀結構）
    const marker = findText(document.body, MARKER_RE);
    if (!marker) return;
    const head = findText(document.body, SUG_HEAD_RE);
    if (head) hide(head);
    for (const a of articles) {
      if (marker.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) hide(a);
    }
    // 同一層裡、標記之後的其他區塊（例如推薦帳號輪播）
    const feed = articles[0].parentElement;
    let after = false;
    for (const c of feed.children) {
      if (c.contains(marker)) { after = true; continue; }
      if (after) hide(c);
    }
  }

  // ---------- 首頁「貼文」模式：格狀版面（像探索頁），每頁 12 篇 ----------
  // Instagram 的動態一次只把畫面附近的幾篇放在頁面上（其他的移除、留空白佔位），
  // 而且是照「一篇一列」算位置的，不能直接把它排成格狀。
  // 所以原本的動態留在頁面上但看不見（style.css：html.igc-grid main），
  // 在背景一段一段捲動它，讓 Instagram 繼續載入貼文；每篇出現時記下圖片、帳號、讚數等資料，
  // 再由我們自己畫成格狀（#igc-grid，蓋在左側選單右邊的整個區域，有自己的捲軸）。
  // 點格子：把背景的動態捲到那一篇，按它的「回應」按鈕，用 Instagram 自己的對話框打開整篇貼文。
  // 廣告、建議貼文已被 filterFeed 藏起來，不算在內。重新整理或重新進入這一頁就回到第 1 頁。
  const PAGE_SIZE = 12;
  const PREFETCH_PAGES = 1; // 先多載入幾頁，按下一頁時馬上就有
  let feedHref = null; // 目前格狀版面對應的網址
  let feedPage = 0; // 目前在第幾頁（從 0 開始）
  let posts = []; // 依第一次出現順序：{ id, user, img, likes, comments, video, carousel, time, y }
  let postById = new Map();
  let busy = false; // 背景捲動中（載入或打開貼文）
  let stopLoading = false; // 要打開貼文：中斷背景載入
  let gridSig = ""; // 上次畫的內容，沒變就不重畫
  let dialogSeenAt = 0; // 最近一次看到貼文對話框的時間
  let overlayPost = null; // 用貼文頁做成的浮動視窗目前顯示的貼文（見 openOverlay）

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function postId(article) {
    const a = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    const m = a && a.getAttribute("href").match(/\/(?:p|reel)\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // 讚數、留言數：動作列裡每個圖示後面緊接著的數字（沒有數字就是 0 或被隱藏）
  const LIKE_LABEL_RE = /^(讚|收回讚|Like|Unlike)$/;
  const COMMENT_LABEL_RE = /^(回應|留言|Comment)$/;
  function readCounts(article) {
    const out = {};
    const icon = [...article.querySelectorAll("section svg[aria-label]")].find((s) =>
      LIKE_LABEL_RE.test(s.getAttribute("aria-label"))
    );
    const row = icon && icon.closest("section").firstElementChild;
    if (!row) return out;
    let key = null;
    for (const c of row.children) {
      const svg = c.querySelector("svg[aria-label]");
      if (svg) {
        const l = svg.getAttribute("aria-label");
        key = LIKE_LABEL_RE.test(l) ? "likes" : COMMENT_LABEL_RE.test(l) ? "comments" : null;
      } else if (key) {
        const t = c.textContent.trim();
        if (/\d/.test(t)) out[key] = t;
        key = null;
      }
    }
    return out;
  }

  // 封面：貼文裡第一張夠大的圖（多張相片是第一張，影片是預覽圖）
  function coverImage(article) {
    for (const img of article.querySelectorAll("img")) {
      if (img.getBoundingClientRect().width < 150) continue; // 大頭貼等小圖
      const src = img.currentSrc || img.src;
      if (src) return src;
    }
    return null;
  }

  function postUser(article) {
    for (const a of article.querySelectorAll("a[href]")) {
      const m = a.getAttribute("href").match(/^\/([^/?#]+)\/$/);
      if (m && !/^(explore|reels?|p|stories)$/.test(m[1])) return m[1];
    }
    return null;
  }

  // 把背景動態裡目前在頁面上的貼文記下來（之前看過的就更新資料）
  function collect() {
    let added = false;
    for (const a of document.querySelectorAll("main article")) {
      const id = postId(a);
      if (!id) continue;
      let p = postById.get(id);
      if (a.classList.contains("igc-hidden")) {
        // 內容載入後才認出是廣告：拿掉，後面的往前遞補
        if (p) {
          posts = posts.filter((x) => x !== p);
          postById.delete(id);
          if (p.live) liveCount--;
        }
        continue;
      }
      if (!p) {
        p = { id };
        postById.set(id, p);
        posts.push(p);
        added = true;
      }
      if (!p.live) {
        p.live = true; // 這次載入頁面時在動態裡看到了（不只是快取裡的）
        liveCount++;
      }
      // 已經有圖片網址（快取裡的）就不換：同一張圖每次載入網址都不同，換了就得重新下載。
      // 舊網址過期載入失敗時會被清掉（ensureGrid 的 error 監聽），這裡再補上新的
      p.img = p.img || coverImage(a);
      p.user = postUser(a) || p.user;
      Object.assign(p, readCounts(a));
      p.video = p.video || !!a.querySelector("video");
      p.carousel =
        p.carousel || !!a.querySelector('button[aria-label="下一步"], button[aria-label="Next"]');
      const t = a.querySelector("time[datetime]");
      if (t) {
        const time = Date.parse(t.getAttribute("datetime"));
        if (time !== p.time) added = true; // 時間變了（或剛讀到）：要重新排序
        p.time = time;
      }
      p.y = Math.round(a.getBoundingClientRect().top + window.scrollY);
    }
    // 「追蹤中」動態是照時間排的：依發文時間由新到舊排，快取裡的舊資料和新載入的貼文才能接在一起
    if (added) sortPosts();
  }
  const sortPosts = () => posts.sort((a, b) => (b.time || 0) - (a.time || 0));

  // ---------- 格狀版面的快取 ----------
  // 每次切到「貼文」都會整頁重新載入，Instagram 的動態一批只有幾篇、每批要 2 秒多，載滿一頁要 10 秒左右。
  // 所以把看過的貼文資料（不含圖片本身，只有圖片網址）存在 chrome.storage.local：
  // 下次打開時先用快取馬上畫出格狀版面，背景照常載入，新貼文依時間插進最前面、舊資料被新的覆蓋。
  // 圖片網址幾天內有效，瀏覽器也已經快取過同一個網址的圖片，所以圖片也是馬上出現；
  // 網址過期載入失敗的格子，改成重新到動態裡找圖片（見 ensureGrid 的 error 監聽）。
  const CACHE_KEY = "igGridCache";
  const CACHE_MAX_AGE = 3 * 24 * 3600 * 1000;
  const CACHE_POSTS = 72;
  let gridCache = null; // 讀進來的快取貼文（還沒放進 posts 的）
  let liveCount = 0; // 這次載入頁面時，動態裡實際看到的貼文數
  chrome.storage.local.get({ [CACHE_KEY]: null }, (r) => {
    const c = r[CACHE_KEY];
    if (!c || !Array.isArray(c.posts) || Date.now() - c.at > CACHE_MAX_AGE) return;
    gridCache = c.posts;
    if (feedHref) seedFromCache(); // 格狀版面已經開了：補進去
  });
  function seedFromCache() {
    if (!gridCache) return;
    for (const c of gridCache) {
      if (!c || !c.id || postById.has(c.id)) continue;
      const p = Object.assign({}, c);
      postById.set(p.id, p);
      posts.push(p);
    }
    sortPosts();
    gridSig = "";
    renderGrid();
  }
  let saveTimer = 0;
  function saveCache() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const keep = posts.filter((p) => p.img && p.time).slice(0, CACHE_POSTS);
      const out = keep.map(({ id, user, img, likes, comments, video, carousel, time }) => ({
        id, user, img, likes, comments, video, carousel, time,
      }));
      chrome.storage.local.set({ [CACHE_KEY]: { at: Date.now(), posts: out } });
    }, 1000);
  }

  const feedEnded = () => !!findText(document.body, MARKER_RE); // 「沒有其他新動態了」

  // 背景動態裡的影片看不見，不要讓它們一直播
  function pauseHiddenVideos() {
    for (const v of document.querySelectorAll("main video")) {
      if (!v.paused) v.pause();
    }
  }

  // 在背景往下捲，直到記下 n 篇（或動態已到底）
  async function loadUntil(n) {
    if (busy) return;
    busy = true;
    try {
      for (let i = 0; i < 250 && liveCount < n && !stopLoading && gridActive(); i++) {
        collect();
        if (liveCount >= n || feedEnded()) break;
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        await sleep(120);
        // 等畫面附近的貼文出現圖片再往下捲（最多 1 秒）：捲太快的話貼文還沒載入圖片就被 Instagram 移除，
        // 格子會是空的，之後還得再捲回去補
        for (let k = 0; k < 10 && !stopLoading && gridActive() && nearbyMissingImage(); k++) await sleep(100);
        renderGrid();
      }
      collect();
    } finally {
      busy = false;
      renderGrid();
    }
  }

  function nearbyMissingImage() {
    const h = window.innerHeight;
    for (const a of document.querySelectorAll("main article")) {
      if (a.classList.contains("igc-hidden") || !postId(a)) continue;
      const r = a.getBoundingClientRect();
      if (r.bottom < -h || r.top > 2 * h) continue;
      if (!coverImage(a)) return true;
    }
    return false;
  }

  // 背景捲動只能在格狀版面開著時進行：離開「貼文」模式（例如從貼文對話框點進個人頁）後還在捲的話，
  // 捲的就是新的那一頁，使用者會一直被往下拉
  const gridActive = () => document.documentElement.classList.contains("igc-grid");

  function findArticle(id) {
    return [...document.querySelectorAll("main article")].find((a) => postId(a) === id) || null;
  }

  // 背景動態捲到某一篇（Instagram 只留畫面附近的貼文），回傳那一篇的 <article>，找不到回傳 null
  async function scrollToPost(p) {
    let art = findArticle(p.id);
    if (!gridActive()) return art;
    if (!art && p.y !== undefined) {
      window.scrollTo(0, Math.max(0, p.y - 100));
      await sleep(150);
      art = findArticle(p.id);
    }
    // 還是不在：看頁面上的貼文排在它前面還是後面，往那個方向找
    const idx = posts.indexOf(p);
    for (let i = 0; !art && i < 60 && !stopLoading && gridActive(); i++) {
      const shown = [...document.querySelectorAll("main article")]
        .map((a) => posts.indexOf(postById.get(postId(a))))
        .filter((x) => x >= 0);
      const down = !shown.length || Math.max(...shown) < idx;
      window.scrollBy(0, (down ? 1 : -1) * Math.round(window.innerHeight * 0.8));
      await sleep(120);
      art = findArticle(p.id);
    }
    return art;
  }

  // 打開貼文：一律用貼文頁做成的浮動視窗（見 openOverlay）。
  // 不再到背景動態裡找那一篇、按它的「回應」按鈕開 Instagram 的對話框：
  // 那樣要先停下背景載入、把動態捲到那一篇（會延遲），關閉留言或找不到的貼文還得換另一種開法，
  // 兩種開法外觀不同、切換時也容易出錯。
  function openPost(id) {
    if (!postById.has(id) || overlayPost) return;
    stopLoading = true; // 背景載入先停（開著的時候背景動態會被換成貼文頁）
    openOverlay(id);
  }

  // 補圖片：背景載入捲得快，有些貼文還沒載入圖片就被 Instagram 移除了，格子會是空的。
  // 目前這一頁有空格子時，把背景動態捲回那幾篇，等圖片出現再記下來（每篇最多試 3 次）
  async function fillMissingImages(items) {
    if (busy) return;
    busy = true;
    try {
      for (const p of items) {
        if (!gridActive() || stopLoading) break;
        if (p.img || (p.imgTries || 0) >= 3) continue;
        p.imgTries = (p.imgTries || 0) + 1;
        const art = await scrollToPost(p);
        for (let i = 0; art && i < 15 && art.isConnected && !coverImage(art) && !stopLoading; i++) await sleep(100);
        collect();
        renderGrid();
      }
    } finally {
      busy = false;
    }
  }

  // ---------- 打不開 Instagram 對話框的貼文：用貼文頁做成浮動視窗 ----------
  // 關閉留言的貼文沒有「回應」按鈕，Instagram 不會開對話框；背景動態裡找不到的貼文也一樣。
  // 這時把網址換成 /p/ID/，讓 Instagram 自己的路由顯示貼文頁（不重新載入頁面，左邊是圖片／影片、右邊是說明和留言），
  // 再用 CSS 把它變成蓋在格狀版面上的浮動視窗（style.css 的 html.igc-post-overlay）。
  // 按視窗外面、× 或 Esc 回上一頁，回到格狀版面。
  function openOverlay(id) {
    overlayPost = id;
    // 背景動態的 <main> 標起來：浮動視窗的樣式只套用到貼文頁的 <main>。
    // 網址變了之後 Instagram 要約半秒才換上貼文頁，這段期間只顯示遮罩，不會把背景動態當成視窗顯示出來
    for (const m of document.querySelectorAll("main")) m.setAttribute("data-igc-feed", "");
    history.pushState(null, "", "/p/" + encodeURIComponent(id) + "/");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    // 從視窗裡點進個人頁再按上一頁時，跳過這一筆，直接回到格狀版面（見 skipDialogEntry）
    const key = window.navigation && navigation.currentEntry && navigation.currentEntry.key;
    if (key) {
      dialogEntries.add(key);
      saveDialogEntries();
    }
  }
  const overlayOn = () => !!overlayPost && location.pathname === "/p/" + overlayPost + "/";
  function closeOverlay() {
    if (overlayOn()) history.back();
  }
  function updateOverlay(on) {
    document.documentElement.classList.toggle("igc-post-overlay", on);
    // 貼文頁外面有 Instagram 設了 z-index: 0 的區塊，把它困在格狀版面底下；開著時讓那幾層不建立堆疊
    if (on) {
      const main = document.querySelector("main:not([data-igc-feed])");
      for (let up = main && main.parentElement; up && up !== document.body; up = up.parentElement) {
        if (!up.classList.contains("igc-unstack-post") && getComputedStyle(up).zIndex !== "auto") up.classList.add("igc-unstack-post");
      }
    }
    let btn = document.getElementById("igc-post-close");
    let shade = document.getElementById("igc-post-shade");
    if (!on) {
      btn?.remove();
      shade?.remove();
      return;
    }
    if (!shade && document.body) {
      shade = document.createElement("div");
      shade.id = "igc-post-shade";
      shade.addEventListener("click", closeOverlay);
      document.body.appendChild(shade);
    }
    if (!btn && document.body) {
      btn = document.createElement("button");
      btn.id = "igc-post-close";
      btn.type = "button";
      btn.setAttribute("aria-label", "Close");
      btn.textContent = "×";
      btn.addEventListener("click", closeOverlay);
      document.body.appendChild(btn);
    }
  }
  // 點到視窗外面（貼文卡片以外的遮罩）就關閉
  document.addEventListener(
    "click",
    (e) => {
      if (!overlayOn()) return;
      const main = e.target.closest && e.target.closest("main");
      if (!main || e.target.closest("main > div > :first-child")) return;
      e.preventDefault();
      e.stopPropagation();
      closeOverlay();
    },
    true
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (overlayOn() && e.key === "Escape") {
        e.stopPropagation();
        closeOverlay();
      }
    },
    true
  );

  // 圖示（線條風格，和 Instagram 一致）
  const ICON_VIDEO =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>';
  const ICON_CAROUSEL =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="13" height="13" rx="2" fill="currentColor"/>' +
    '<path d="M4 16V6a2 2 0 0 1 2-2h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const ICON_HEART =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.6a4.4 4.4 0 0 1 7.5 2.8c0 5.5-7.5 10.1-7.5 10.1z" fill="currentColor"/></svg>';
  const ICON_COMMENT =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 11.6a8.4 8.4 0 0 1-12.3 7.5L3.5 20.5l1.4-4.6a8.4 8.4 0 1 1 15.6-4.3z" fill="currentColor"/></svg>';

  function ensureGrid() {
    let grid = document.getElementById("igc-grid");
    if (grid) return grid;
    grid = document.createElement("div");
    grid.id = "igc-grid";
    grid.tabIndex = -1; // 讓空白鍵、方向鍵捲動格狀版面
    grid.innerHTML =
      '<div id="igc-grid-inner"><div id="igc-grid-head"></div><div id="igc-grid-tiles"></div>' +
      '<nav id="igc-pager"><button type="button" data-go="-1"></button><span></span>' +
      '<button type="button" data-go="1"></button></nav></div>';
    // 快取裡的圖片網址過期、載入失敗：清掉，讓 showGrid 到動態裡重新找這一篇的圖片
    grid.addEventListener(
      "error",
      (e) => {
        const tile = e.target.tagName === "IMG" && e.target.closest(".igc-tile");
        const p = tile && postById.get(tile.dataset.id);
        if (!p) return;
        p.img = null;
        p.imgTries = 0;
        gridSig = "";
        schedule();
      },
      true
    );
    grid.addEventListener("click", (e) => {
      const tile = e.target.closest(".igc-tile");
      if (tile) {
        e.preventDefault();
        openPost(tile.dataset.id);
        return;
      }
      const btn = e.target.closest("#igc-pager button[data-go]");
      if (btn && !btn.disabled) {
        feedPage = Math.max(0, feedPage + Number(btn.dataset.go));
        grid.scrollTop = 0;
        renderGrid();
      }
    });
    document.body.appendChild(grid);
    grid.focus({ preventScroll: true });
    return grid;
  }

  // 格狀版面放在左側選單（收合時）的右邊；滑鼠移到選單上時選單展開（72px → 238px），蓋在格狀版面上面，版面不移動。
  // 選單是 position: fixed 的區塊，從裡面的「探索」連結往上找：
  // - 貼齊左邊、和畫面差不多高的那一層的右緣 = 選單寬度。取看過最窄的（＝收合時），
  //   視窗大小改變時重新量（有些寬度下選單一直是展開的）
  // - 選單外面幾層 Instagram 的區塊設了 z-index: 0，把選單困在格狀版面底下；
  //   標上 .igc-unstack，貼文模式時拿掉（style.css），選單自己的 z-index 才比格狀版面高
  let sidebarMin = 0;
  window.addEventListener("resize", () => (sidebarMin = 0));
  function measureSidebar() {
    const link = document.querySelector('a[href="/explore/"]');
    let right = 0;
    let el = link;
    for (; el && el !== document.body; el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.left < 10 && r.height > window.innerHeight / 2) right = Math.max(right, Math.round(r.right));
      if (getComputedStyle(el).position === "fixed") break;
    }
    if (el && el !== document.body) {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        if (up.classList.contains("igc-unstack") || getComputedStyle(up).zIndex !== "auto") up.classList.add("igc-unstack");
      }
    }
    if (right) sidebarMin = sidebarMin ? Math.min(sidebarMin, right) : right;
    return right ? sidebarMin : 0;
  }
  function placeGrid(grid) {
    grid.style.left = measureSidebar() + "px";
  }

  // ---------- 首頁右側的推薦帳號（連同上面你自己的帳號） ----------
  // 彈出視窗的開關（igSuggestHidden，預設藏起來）。
  // 右側欄和動態欄是同一個置中排列的 flex 列的兩個子元素；找到右側欄（裡面有「© 年份 INSTAGRAM FROM META」，
  // 不管介面語言都一樣），標上 data-igc-suggest，藏起來後動態欄自然置中。
  // 這一列從畫面最左邊開始（左側選單蓋在上面），左邊補上選單的寬度，才會在選單右邊的空間置中。
  // 彈出視窗的兩個開關（預設都藏起來）：設定名稱 → <html> 上的 class
  const HIDE_SETTINGS = { igSuggestHidden: "igc-hide-suggest", igDmHidden: "igc-hide-dm" };
  const applyHide = (key, on) => document.documentElement.classList.toggle(HIDE_SETTINGS[key], on !== false);
  for (const key in HIDE_SETTINGS) applyHide(key, true);
  chrome.storage.local.get({ igSuggestHidden: true, igDmHidden: true }, (r) => {
    for (const key in HIDE_SETTINGS) applyHide(key, r[key]);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const key in HIDE_SETTINGS) if (changes[key]) applyHide(key, changes[key].newValue);
  });
  // ---------- 右下角的「訊息」浮動按鈕 ----------
  // 開關 igDmHidden（預設藏起來）。按鈕是 position: fixed 的一層，裡面是 role="button"；
  // 用位置找（貼在畫面右下角），不靠文字，介面是哪種語言都找得到。標上 data-igc-dm。
  // 顯示時：貼文模式的格狀版面（z-index 1）會蓋住它，因為外層有 z-index: 0 的區塊把它困在底下；
  // 標上 .igc-unstack（style.css 只在格狀版面時生效），再把它的 z-index 提高，就會浮在格狀版面上面。
  function markDm() {
    let box = document.querySelector("[data-igc-dm]");
    if (!box) {
      for (const btn of document.querySelectorAll('body > div [role="button"]')) {
        const fixed = btn.parentElement;
        if (!fixed || !btn.querySelector("svg")) continue;
        const r = btn.getBoundingClientRect();
        if (!r.width || r.right < window.innerWidth * 0.7 || r.bottom < window.innerHeight * 0.75) continue;
        if (getComputedStyle(fixed).position !== "fixed") continue;
        box = fixed;
        box.setAttribute("data-igc-dm", "");
        break;
      }
      if (!box) return;
    }
    for (let up = box.parentElement; up && up !== document.body; up = up.parentElement) {
      if (!up.classList.contains("igc-unstack") && getComputedStyle(up).zIndex !== "auto") up.classList.add("igc-unstack");
    }
  }

  function markSuggest() {
    const main = document.querySelector("main");
    if (!main) return;
    let col = main.querySelector("[data-igc-suggest]");
    if (!col) {
      const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) if (/INSTAGRAM FROM META/i.test(n.nodeValue)) break;
      if (!n) return;
      col = n.parentElement;
      while (col && col.parentElement && col.parentElement.parentElement !== main) col = col.parentElement;
      if (!col || !col.parentElement || col.parentElement.parentElement !== main) return;
      col.setAttribute("data-igc-suggest", "");
      col.parentElement.setAttribute("data-igc-suggest-row", "");
    }
    const side = measureSidebar() + "px";
    const row = col.parentElement;
    if (row.style.getPropertyValue("--igc-side") !== side) row.style.setProperty("--igc-side", side);
  }

  // 今天以前的貼文：格子變淡（滑鼠移上去恢復），今天的貼文比較醒目。
  // 貼文的 <time datetime> 是確切時間，直接比今天 00:00；還不知道時間的當成今天
  function tileHtml(p, midnight) {
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
    const badge = p.video ? ICON_VIDEO : p.carousel ? ICON_CAROUSEL : "";
    return (
      '<a class="igc-tile' + (p.time < midnight ? " igc-tile-earlier" : "") +
      '" href="/p/' + esc(p.id) + '/" data-id="' + esc(p.id) + '">' +
      (p.img ? '<img src="' + esc(p.img) + '" alt="" draggable="false">' : "") +
      (badge ? '<span class="igc-tile-badge">' + badge + "</span>" : "") +
      '<span class="igc-tile-info">' +
      (p.user ? '<span class="igc-tile-user">' + esc(p.user) + "</span>" : "") +
      '<span class="igc-tile-stats">' +
      (p.likes ? "<span>" + ICON_HEART + esc(p.likes) + "</span>" : "") +
      (p.comments ? "<span>" + ICON_COMMENT + esc(p.comments) + "</span>" : "") +
      "</span></span></a>"
    );
  }

  // 更新格子：同一篇貼文沿用原本的格子，只改有變的地方（圖片網址、讚數…），再照新的順序排好。
  // 不整個重畫：整個換掉的話每張圖片都要重新解碼，畫面會閃一下
  function renderTiles(box, items, midnight, msg) {
    const old = new Map();
    for (const a of box.querySelectorAll(".igc-tile")) old.set(a.dataset.id, a);
    const tpl = document.createElement("template");
    const want = [];
    for (const p of items) {
      tpl.innerHTML = tileHtml(p, midnight);
      const fresh = tpl.content.firstElementChild;
      const a = old.get(p.id);
      if (!a) {
        want.push(fresh);
        continue;
      }
      a.className = fresh.className;
      const img = a.querySelector("img");
      const newImg = fresh.querySelector("img");
      if (!newImg) img?.remove();
      else if (!img) a.prepend(newImg);
      else if (img.getAttribute("src") !== newImg.getAttribute("src")) img.setAttribute("src", newImg.getAttribute("src"));
      for (const sel of [".igc-tile-badge", ".igc-tile-info"]) {
        const cur = a.querySelector(sel);
        const next = fresh.querySelector(sel);
        if (!next) cur?.remove();
        else if (!cur) a.appendChild(next);
        else if (cur.innerHTML !== next.innerHTML) cur.innerHTML = next.innerHTML;
      }
      want.push(a);
    }
    if (msg) {
      let m = box.querySelector(".igc-grid-loading");
      if (!m) {
        m = document.createElement("div");
        m.className = "igc-grid-loading";
      }
      setText(m, msg);
      want.push(m);
    }
    want.forEach((node, i) => {
      if (box.children[i] !== node) box.insertBefore(node, box.children[i] || null);
    });
    while (box.children.length > want.length) box.lastElementChild.remove();
  }

  function renderGrid() {
    const grid = document.getElementById("igc-grid");
    if (!grid) return;
    placeGrid(grid);
    const start = feedPage * PAGE_SIZE;
    const items = posts.slice(start, start + PAGE_SIZE);
    const ended = feedEnded();
    const loadingPage = items.length < PAGE_SIZE && !ended;
    const midnight = new Date().setHours(0, 0, 0, 0);
    // 只比對畫面上看得到的欄位（貼文在背景動態裡的位置 y 等一直在變，不算）
    const shown = items.map((p) => [p.id, p.img, p.user, p.likes, p.comments, p.video, p.carousel, p.time < midnight]);
    const sig = JSON.stringify([doomntI18n.lang, feedPage, ended, loadingPage, shown]);
    if (sig === gridSig) return;
    gridSig = sig;
    saveCache();

    const msg = loadingPage ? t("loading") : !items.length ? t("noMorePosts") : null;
    renderTiles(grid.querySelector("#igc-grid-tiles"), items, midnight, msg);

    const [prev, label, next] = grid.querySelector("#igc-pager").children;
    const lastPage = ended && posts.length <= start + PAGE_SIZE;
    prev.disabled = feedPage === 0;
    setText(prev, t("prev"));
    setText(label, t("page", { n: feedPage + 1 }));
    next.disabled = lastPage || loadingPage;
    setText(next, lastPage ? t("noMorePosts") : t("next"));
  }

  function showGrid() {
    if (!busy) stopLoading = false; // 離開格狀版面時設的停止旗標：回來後清掉
    if (feedHref !== location.href) {
      feedHref = location.href;
      feedPage = 0;
      posts = [];
      postById = new Map();
      liveCount = 0;
      gridSig = "";
      seedFromCache();
    }
    document.documentElement.classList.add("igc-grid");
    ensureGrid();
    pauseHiddenVideos();
    collect();
    renderGrid();
    if (busy) return;
    // 本頁有還沒有圖片的格子：先補圖片
    const items = posts.slice(feedPage * PAGE_SIZE, (feedPage + 1) * PAGE_SIZE);
    if (items.some((p) => !p.img && (p.imgTries || 0) < 3)) {
      fillMissingImages(items);
      return;
    }
    // 本頁和下一頁還沒載滿：在背景繼續捲動載入
    if (!feedEnded() && liveCount < (feedPage + 1 + PREFETCH_PAGES) * PAGE_SIZE) {
      loadUntil((feedPage + 1 + PREFETCH_PAGES) * PAGE_SIZE);
    }
  }

  // ---------- 離開首頁時，舊的首頁不要露出來 ----------
  // 從首頁（限時動態或貼文）切到 Instagram 自己的頁面（訊息、個人頁、探索…）時，網址先變，
  // 舊的首頁會在畫面上多留約 1 秒才被換掉。這段期間首頁的 class 已經拿掉，
  // 原本那一列限時動態、「追蹤中」的動態等就會露出來。
  // 所以離開時把當下的 <main>（和後面的頁尾連結）標上 data-igc-stale 藏起來；
  // Instagram 會把它整個移除換成新頁面的 <main>，新的不受影響。保險起見最多藏 STALE_MAX。
  const STALE_MAX = 2500;
  let staleAt = 0;
  function markStale() {
    for (const m of document.querySelectorAll("main")) m.setAttribute("data-igc-stale", "");
    staleAt = Date.now();
  }
  function releaseStale(force) {
    if (!staleAt || (!force && Date.now() - staleAt < STALE_MAX)) return;
    for (const m of document.querySelectorAll("[data-igc-stale]")) m.removeAttribute("data-igc-stale");
    staleAt = 0;
  }

  function hideGrid() {
    const grid = document.getElementById("igc-grid");
    if (grid) {
      markStale();
      grid.remove();
      // 停下背景捲動；背景動態被捲到很下面，新的一頁（個人頁等）從最上面開始，不要停在那個位置
      stopLoading = true;
      window.scrollTo(0, 0);
    }
    document.documentElement.classList.remove("igc-grid");
    gridSig = "";
  }

  // ---------- 貼文頁：移除「更多「某帳號」的貼文」影片牆 ----------
  function hideMorePosts() {
    if (!document.body) return; // 剛載入（document_start）時還沒有 <body>
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!MORE_POSTS_RE.test(n.textContent.trim())) continue;
      // 往上找「標題 + 影片牆」那一整塊：盡量往上，但不能包到正在看的這篇貼文
      // （影片牆的縮圖不一定是連結，只看「有沒有貼文連結」會一路爬到包著整頁的外層，把貼文本身也藏掉）。
      // 停止條件：碰到 <main> 或它的直接子元素、碰到含有這篇貼文連結或影片的區塊
      const cur = (location.pathname.match(/^\/(?:[^/]+\/)?(?:p|reel)\/([^/?#]+)/) || [])[1];
      let block = null;
      for (let el = n.parentElement; el && el !== document.body; el = el.parentElement) {
        if (el.tagName === "MAIN" || (el.parentElement && el.parentElement.tagName === "MAIN")) break;
        if (el.querySelector("video, article")) break;
        if (cur && el.querySelector('a[href*="/' + cur + '/"]')) break;
        block = el;
      }
      if (block && block.querySelector('a[href*="/p/"], a[href*="/reel/"], img')) hide(block);
    }
  }

  // ---------- 首頁（限時動態模式）：整個貼文區塊不顯示 ----------
  // 首頁的結構是「限時動態列」和「貼文區塊」兩個兄弟元素。
  // 從第一篇貼文往上找，找到「前面有兄弟含 <canvas>（限時動態的彩色外框）」的那一層，就是貼文區塊。
  // 只加上標記 class，實際隱藏由 CSS 在 html.igc-stories-only 時才生效，
  // 這樣切到「貼文」模式時，就算 Instagram 重用同一個 DOM 也不會被誤藏。
  function markHomePosts() {
    const art = document.querySelector("main article");
    if (!art) return;
    let el = art;
    while (el.parentElement && el.parentElement.tagName !== "MAIN") {
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.querySelector("canvas")) {
          el.classList.add("igc-home-posts");
          return;
        }
      }
      el = el.parentElement;
    }
  }

  // ---------- 限時動態：換行排列的頭像，不用左右捲 ----------
  // Instagram 的限時動態列只渲染畫面附近的十幾個（其餘用 scrollLeft 虛擬捲動），要按箭頭往右捲才看得到更多。
  // 改成：原本那一列藏起來（高度 0，但還在頁面上），在背景把它從頭捲到尾，記下每一個人；
  // 在它下方畫自己的版面：頭像換行排列，全部一次看到。沒看過的在前面，看過的變淡排在後面。
  // - 看過／沒看過：讀頭像外圈的 <canvas>（彩色 = 沒看過，灰色 = 看過），和介面語言無關
  // - 點頭像：把原本那一列捲到那個人，按它的按鈕，打開 Instagram 自己的限時動態播放器
  // - 從播放器回來（網址從 /stories/… 變回 /）時重新掃一次，更新看過的狀態
  let stories = new Map(); // 帳號 → { name, img, seen, x }
  let storyTray = null; // 目前掃描的那一列
  let storyScanning = false;
  let storyStop = false;
  let storySig = "";
  let storyPrevPath = null;
  let storyReady = false; // 這一列第一次掃描完成了沒（完成前不顯示頭像，只顯示「載入中」）
  let viewerFromHome = false; // 目前的限時動態播放器是從首頁打開的

  function findTray() {
    const posts = document.querySelector(".igc-home-posts");
    for (let sib = posts && posts.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (!sib.id && sib.querySelector("li canvas")) return sib;
    }
    return null;
  }
  function trayScroller(tray) {
    const li = tray.querySelector("li");
    for (let e = li && li.parentElement; e && e !== tray.parentElement; e = e.parentElement) {
      if (e.scrollWidth > e.clientWidth + 10 && /auto|scroll|hidden/.test(getComputedStyle(e).overflowX)) return e;
    }
    return null;
  }
  // 外圈有顏色 → 沒看過；灰色 → 看過；還沒畫出來 → null
  function ringSeen(canvas) {
    try {
      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      let drawn = false;
      let sat = 0;
      for (const [x, y] of [[w / 2, 2], [2, w / 2], [w / 2, w - 3], [w - 3, w / 2]]) {
        const d = ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        if (d[3] > 0) drawn = true;
        sat = Math.max(sat, Math.max(d[0], d[1], d[2]) - Math.min(d[0], d[1], d[2]));
      }
      return drawn ? sat < 60 : null;
    } catch {
      return null;
    }
  }
  function readTray(tray, sc) {
    const base = sc.getBoundingClientRect().left - sc.scrollLeft;
    for (const li of tray.querySelectorAll("li")) {
      const btn = li.querySelector('[role="button"]');
      const name = li.textContent.trim();
      if (!btn || !name) continue;
      const img = li.querySelector("img");
      const canvas = li.querySelector("canvas");
      const old = stories.get(name);
      const seen = canvas ? ringSeen(canvas) : null;
      stories.set(name, {
        name,
        img: (img && img.src) || (old && old.img) || "",
        seen: seen === null ? (old ? old.seen : false) : seen,
        x: Math.round(li.getBoundingClientRect().left - base),
      });
    }
  }
  // 整頁載入時，Instagram 把限時動態列的完整資料（每個人一筆）直接寫在 HTML 裡的
  // <script type="application/json">（xdt_api__v1__feed__reels_tray.tray）。
  // 只拿來知道「總共應該有幾個人」，掃描少於這個數字就再掃一次。站內換頁回首頁時沒有這份資料 → null
  let ssrTrayCount;
  function expectedFromSsr() {
    if (ssrTrayCount !== undefined) return ssrTrayCount;
    ssrTrayCount = null;
    try {
      for (const s of document.querySelectorAll('script[type="application/json"]')) {
        const text = s.textContent;
        if (!text.includes('"xdt_api__v1__feed__reels_tray"')) continue;
        const find = (o, depth) => {
          if (!o || typeof o !== "object" || depth > 40) return null;
          if (o.xdt_api__v1__feed__reels_tray && Array.isArray(o.xdt_api__v1__feed__reels_tray.tray))
            return o.xdt_api__v1__feed__reels_tray.tray.length;
          for (const k in o) {
            const r = find(o[k], depth + 1);
            if (r !== null) return r;
          }
          return null;
        };
        ssrTrayCount = find(JSON.parse(text), 0);
        if (ssrTrayCount !== null) break;
      }
    } catch {}
    return ssrTrayCount;
  }
  // 依捲動區的總寬度估計有幾個人（每個頭像的間距固定）
  function expectedFromWidth(tray, sc) {
    const lis = [...tray.querySelectorAll("li")]
      .map((li) => li.getBoundingClientRect().left)
      .sort((a, b) => a - b);
    let pitch = 0;
    for (let i = 1; i < lis.length; i++) {
      const d = lis[i] - lis[i - 1];
      if (d > 20 && (!pitch || d < pitch)) pitch = d;
    }
    return pitch ? Math.floor((sc.scrollWidth + 2) / pitch) : 0;
  }
  // 把整列從頭捲到尾讀一次。回傳捲動區（找不到 → null）
  async function scanOnce(tray) {
    // 頁面剛載入時捲動區可能還沒排版好（沒有橫向溢出）。先等它一下，
    // 不然只會讀到畫面上那十幾個（之前就是這樣只出現前 13 個人）
    let sc = trayScroller(tray);
    const want = expectedFromSsr();
    const shown = tray.querySelectorAll("li").length;
    const waitMax = want && want > shown ? 3000 : 600;
    for (let t = 0; !sc && t < waitMax && !storyStop && tray === storyTray && tray.isConnected; t += 100) {
      await sleep(100);
      sc = trayScroller(tray);
    }
    if (!sc) {
      readTray(tray, tray);
      return null;
    }
    sc.scrollLeft = 0;
    await sleep(100);
    let lastWidth = 0;
    let still = 0;
    for (let i = 0; i < 200 && !storyStop && tray === storyTray && tray.isConnected; i++) {
      readTray(tray, sc);
      if (sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 2) {
        // 到底了：人數已經和 HTML 裡的資料一樣就結束；否則等一下看 Instagram 會不會再載入更多
        if (want && stories.size >= want) break;
        still = sc.scrollWidth === lastWidth ? still + 1 : 0;
        lastWidth = sc.scrollWidth;
        if (still > 3) break;
        await sleep(300);
        continue;
      }
      sc.scrollLeft += sc.clientWidth;
      await sleep(150);
    }
    return sc;
  }
  async function scanTray(tray) {
    if (storyScanning) return;
    storyScanning = true;
    storyStop = false;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const sc = await scanOnce(tray);
        if (storyStop || tray !== storyTray || !tray.isConnected) break;
        // 讀到的人數比應有的少（還沒載入完、捲太快漏掉）→ 再掃一次
        const want = Math.max(expectedFromSsr() || 0, sc ? expectedFromWidth(tray, sc) : 0);
        if (stories.size >= want - 1) break;
        await sleep(500);
      }
      const sc = trayScroller(tray);
      if (sc && !storyStop) sc.scrollLeft = 0;
    } finally {
      storyScanning = false;
      if (tray === storyTray && tray.isConnected && !storyStop) storyReady = true;
      // 掃描途中 Instagram 換了一個新的限時動態列：重新掃新的那一列
      if (storyTray && storyTray !== tray && storyTray.isConnected) scanTray(storyTray);
      else renderStories();
    }
  }
  function renderStories() {
    const tray = storyTray;
    if (!tray || !tray.isConnected) return;
    let box = document.getElementById("igc-stories");
    if (!box) {
      box = document.createElement("div");
      box.id = "igc-stories";
      box.addEventListener("click", (e) => {
        const b = e.target.closest(".igc-story");
        if (b) openStory(b.dataset.name);
      });
    }
    if (box.previousElementSibling !== tray) tray.after(box);
    // 第一次掃描完成前只顯示「載入中」，全部載入完才一次顯示（不會一個一個冒出來）；
    // 之後重新掃描（更新看過的狀態）時保留原本的版面，掃完才更新
    if (!storyReady) {
      storySig = "";
      return;
    }
    if (storyScanning) return;
    const list = [...stories.values()].sort((a, b) => a.seen - b.seen || a.x - b.x);
    const sig = JSON.stringify([doomntI18n.lang, list]);
    if (sig === storySig) return;
    storySig = sig;
    const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => "&#" + c.charCodeAt(0) + ";");
    let html = "";
    for (const s of list) {
      html +=
        '<button type="button" class="igc-story' + (s.seen ? " igc-story-seen" : "") + '" data-name="' + esc(s.name) + '">' +
        '<span class="igc-story-ring">' + (s.img ? '<img src="' + esc(s.img) + '" alt="" draggable="false">' : "") + "</span>" +
        '<span class="igc-story-name">' + esc(s.name) + "</span></button>";
    }
    box.innerHTML = html;
    if (document.documentElement.classList.contains("igc-stories-ready")) return;
    // 第一次顯示：等頭像圖片都載入好（最多 IMG_WAIT_MAX）再整頁顯示，不會先出現灰色的空圈圈
    const imgs = [...box.querySelectorAll("img")];
    Promise.race([
      Promise.all(imgs.map((im) => im.decode().catch(() => {}))),
      sleep(IMG_WAIT_MAX),
    ]).then(markStoriesReady);
  }
  const IMG_WAIT_MAX = 3000;
  // 首頁（限時動態模式）在限時動態全部載入、畫好之前整個 <main> 藏起來（style.css），
  // 重新整理時才不會先閃出原本的一列限時動態。萬一一直找不到限時動態列（例如沒有任何限時動態），
  // 最多藏 STORIES_WAIT_MAX 就照常顯示
  const STORIES_WAIT_MAX = 10000;
  function markStoriesReady() {
    document.documentElement.classList.add("igc-stories-ready");
    document.getElementById("igc-loader")?.remove();
  }
  // 計時從「第一次進到首頁限時動態模式」開始算（不是從腳本載入：先在別頁待了一陣子再回首頁，
  // 會一回來就時間到，還沒畫好的空白頁面直接露出來）
  let storyWaitTimer = 0;
  // 點頭像：不按原本那一列的按鈕（那樣打開的播放器兩側會有其他帳號，看完會接著播下一個人），
  // 而是直接把網址換成 /stories/帳號/，讓 Instagram 自己的路由打開播放器：
  // 這樣只會播這個人的限時動態，兩側沒有其他帳號，看完自動關閉、回到首頁（和從個人頁點大頭貼一樣）。
  // 不重新載入頁面，也不會出現「以某某身分觀看？」的確認。
  function openStory(name) {
    if (!stories.has(name)) return;
    storyStop = true; // 背景掃描先停下來
    history.pushState(null, "", "/stories/" + encodeURIComponent(name) + "/");
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
  }
  function updateStories(p, storiesOnly) {
    const back = storyPrevPath !== null && storyPrevPath !== "/" && p === "/";
    storyPrevPath = p;
    if (!storiesOnly) return;
    if (!storyWaitTimer) storyWaitTimer = setTimeout(markStoriesReady, STORIES_WAIT_MAX);
    const tray = findTray();
    if (!tray) return;
    tray.setAttribute("data-igc-tray", "");
    if (tray !== storyTray) {
      // 新的一列（第一次載入，或 Instagram 重新渲染）：重新掃描。
      // 已經顯示過的話保留原本的頭像，掃完才更新，不會整個消失再出現
      storyTray = tray;
      if (!storyReady) {
        stories = new Map();
        storySig = "";
      }
      scanTray(tray);
    } else if (back && !storyScanning) scanTray(tray); // 從限時動態播放器（或別頁）回來：更新看過的狀態
    renderStories();
  }

  // 換語言時馬上更新格狀版面和左側選單按鈕的文字
  doomntI18n.onChange(() => {
    renderGrid();
    renderStories();
    schedule();
  });

  // ---------- 左側選單：「限時動態」「貼文」兩個按鈕取代「首頁」 ----------
  // 找到選單裡的「首頁」那一項（連到 / 的連結，所在的清單有好幾項；最上面的 Instagram 標誌也連到 /，但不在清單裡），
  // 複製它的外觀做成兩項插在它前面，原本的「首頁」藏起來（style.css 的 [data-igc-home]）。
  // 複製出來的連結沒有 Instagram 的點擊處理，點下去就是一般的連結（整頁載入對應的模式）。
  // 目前的模式：圖示變實心、文字變粗（和 Instagram 自己的選取狀態一樣）。
  const SVG_OPEN = '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" width="24" height="24">';
  const NAV_ICONS = {
    // 限時動態：中間一個圓，外面一圈斷開的環
    stories: (on) =>
      SVG_OPEN +
      '<circle cx="12" cy="12" r="5"' + (on ? ' fill="currentColor"' : "") + "/>" +
      '<circle cx="12" cy="12" r="10" pathLength="60" stroke-dasharray="7 3" stroke-linecap="round" transform="rotate(-75 12 12)"/></svg>',
    // 貼文：2×2 的格子
    posts: (on) => {
      let r = "";
      for (const [x, y] of [[3, 3], [13.5, 3], [3, 13.5], [13.5, 13.5]]) {
        r += '<rect x="' + x + '" y="' + y + '" width="7.5" height="7.5" rx="1.5"' + (on ? ' fill="currentColor"' : "") + "/>";
      }
      return SVG_OPEN + r + "</svg>";
    },
  };
  const NAV_HREF = { stories: "/", posts: "/?variant=following" };
  function findHomeItem() {
    for (const a of document.querySelectorAll('a[href="/"]')) {
      if (a.closest("[data-igc-nav]") || !a.querySelector("svg")) continue;
      let item = a;
      while (item.parentElement && item.parentElement.children.length === 1) item = item.parentElement;
      if (item.parentElement && item.parentElement.children.length >= 4) return item;
    }
    return null;
  }
  function makeNavItem(home, mode) {
    const item = home.cloneNode(true);
    item.removeAttribute("data-igc-home");
    item.setAttribute("data-igc-nav", mode);
    const a = item.querySelector('a[href="/"]');
    a.setAttribute("href", NAV_HREF[mode]);
    // 文字：最裡面那個有字的節點
    const label = [...item.querySelectorAll("span")].reverse().find((sp) => !sp.children.length && sp.textContent.trim());
    if (label) label.setAttribute("data-igc-nav-label", "");
    return item;
  }
  // 選單展開（滑鼠移上去）時，Instagram 用行內樣式讓每一項的文字滑出來；被藏起來的「首頁」也會跟著變，
  // 複製出來的兩項不會。所以把「首頁」裡每個元素（圖示以外）的 style 照抄過來，文字才會一起出現、消失
  let navWatched = null;
  const navObserver = new MutationObserver(() => {
    const home = document.querySelector("[data-igc-home]");
    if (home) syncNavStyles(home, [...document.querySelectorAll("[data-igc-nav]")]);
  });
  function syncNavStyles(home, items) {
    const plain = (root) => [root, ...root.querySelectorAll("*")].filter((e) => !e.closest("svg"));
    const src = plain(home);
    for (const it of items) {
      const dst = plain(it);
      if (dst.length !== src.length) continue;
      for (let i = 1; i < src.length; i++) {
        // 最外層（i = 0）不抄：「首頁」本身是 display: none
        const st = src[i].getAttribute("style");
        if (dst[i].getAttribute("style") !== st) {
          if (st === null) dst[i].removeAttribute("style");
          else dst[i].setAttribute("style", st);
        }
      }
    }
  }
  function updateNav(p, storiesOnly) {
    let home = document.querySelector("[data-igc-home]");
    if (!home || !home.isConnected) home = findHomeItem();
    if (!home) return;
    let items = [...document.querySelectorAll("[data-igc-nav]")];
    if (!home.hasAttribute("data-igc-home") || items.length !== 2 || items[1].nextElementSibling !== home) {
      for (const it of items) it.remove();
      home.setAttribute("data-igc-home", "");
      items = [makeNavItem(home, "stories"), makeNavItem(home, "posts")];
      home.before(items[0], items[1]);
    }
    syncNavStyles(home, items);
    // 「首頁」的 style 一變就馬上同步（選單展開的動畫很快，不等下一次檢查）
    if (navWatched !== home) {
      navWatched = home;
      navObserver.disconnect();
      navObserver.observe(home, { attributes: true, attributeFilter: ["style"], subtree: true });
    }
    const current = p === "/" ? (storiesOnly ? "stories" : "posts") : null;
    for (const it of items) {
      const mode = it.getAttribute("data-igc-nav");
      const on = mode === current;
      it.classList.toggle("igc-nav-active", on);
      const a = it.querySelector("a");
      const svg = a.querySelector("svg");
      if (svg && svg.getAttribute("data-igc-on") !== String(on)) {
        const tmp = document.createElement("div");
        tmp.innerHTML = NAV_ICONS[mode](on);
        const icon = tmp.firstChild;
        icon.setAttribute("class", svg.getAttribute("class") || "");
        icon.setAttribute("data-igc-on", String(on));
        svg.replaceWith(icon);
      }
      const label = it.querySelector("[data-igc-nav-label]");
      if (label) setText(label, t(mode));
      if (a.getAttribute("aria-label") !== t(mode)) a.setAttribute("aria-label", t(mode));
    }
  }

  // ---------- 載入畫面：Doomn't 標誌的三條橫槓輪流亮起 ----------
  // 首頁（限時動態模式）在限時動態全部載入前整個藏起來（見 markStoriesReady），這段時間在中間顯示這個動畫。
  // 放在 <body> 最後、固定位置；左邊讓出左側選單的寬度，置中在選單右邊的空間。
  const LOADER_SVG =
    '<svg viewBox="0 0 100 100" width="72" height="72" aria-hidden="true">' +
    '<rect width="100" height="100" rx="22" fill="#1E1E1E"/>' +
    '<rect class="igc-loader-bar" x="26" y="16" width="48" height="18" rx="4" fill="#F4F3EF"/>' +
    '<rect class="igc-loader-bar" x="26" y="41" width="48" height="18" rx="4" fill="#F4F3EF"/>' +
    '<rect class="igc-loader-bar" x="26" y="66" width="48" height="18" rx="4" fill="#F4F3EF"/>' +
    '<rect class="igc-loader-line" x="12" y="47" width="76" height="6" rx="3" fill="#FF4F1A"/></svg>';
  function updateLoader() {
    const root = document.documentElement;
    const waiting = root.classList.contains("igc-stories-only") && !root.classList.contains("igc-stories-ready");
    let el = document.getElementById("igc-loader");
    if (!waiting) {
      if (el) el.remove();
      return;
    }
    if (!document.body) return;
    if (!el) {
      el = document.createElement("div");
      el.id = "igc-loader";
      el.innerHTML = LOADER_SVG;
      document.body.appendChild(el);
    }
    const left = measureSidebar() + "px";
    if (el.style.left !== left) el.style.left = left;
  }

  // ---------- 離開頁面時，舊內容繼續藏著 ----------
  // Instagram 換頁時網址先變，舊頁面（探索貼文牆、首頁貼文）會留在畫面上直到新頁載入完。
  // 如果網址一變就拿掉 html 上的 class，舊內容會閃一下。
  // 所以離開前先把舊節點標上 .igc-linger 繼續藏著。
  //
  // 為了不誤藏新頁面，條件很嚴格：
  // 1. 只標記「在被藏的那一頁上已經出現超過 SETTLE_MS」的貼文連結所在的節點，
  //    剛渲染出來的（可能已經是新頁面的內容）不算。
  // 2. 記下每個節點離開時的舊連結；只要節點裡已經沒有任何一個舊連結
  //    （被移除，或被 Instagram 重用成新內容），立刻放開。
  // 3. 最多藏 LINGER_MS，作為最後保險。
  const EXPLORE_GRID_SEL = 'main[role="main"] > div > div:nth-child(n + 2)';
  const HOME_POSTS_SEL = ".igc-home-posts, main article";
  const POST_LINK_SEL = 'a[href*="/p/"], a[href*="/reel/"]';
  const SETTLE_MS = 500;
  const LINGER_MS = 3000;
  const seenLinks = new Map(); // 被藏頁面上的連結 → 第一次看到的時間
  const lingerLinks = new WeakMap(); // 標記中的節點 → 它的舊連結
  let lingerSince = 0;
  let trackedPage = null; // seenLinks 屬於哪一頁

  function postLinks(el) {
    const links = [...el.querySelectorAll(POST_LINK_SEL)];
    if (el.matches(POST_LINK_SEL)) links.push(el);
    return links.map((a) => a.getAttribute("href"));
  }

  function trackSeen(selector) {
    const now = Date.now();
    for (const el of document.querySelectorAll(selector)) {
      for (const href of postLinks(el)) {
        if (!seenLinks.has(href)) seenLinks.set(href, now);
      }
    }
  }

  function linger(selector) {
    const now = Date.now();
    for (const el of document.querySelectorAll(selector)) {
      const old = postLinks(el).filter((h) => seenLinks.has(h) && now - seenLinks.get(h) >= SETTLE_MS);
      if (!old.length) continue;
      el.classList.add("igc-linger");
      lingerLinks.set(el, new Set(old));
    }
    lingerSince = now;
  }

  function releaseLinger() {
    const expired = Date.now() - lingerSince > LINGER_MS;
    for (const el of document.querySelectorAll(".igc-linger")) {
      const old = lingerLinks.get(el);
      if (expired || !old || !postLinks(el).some((h) => old.has(h))) {
        el.classList.remove("igc-linger");
        lingerLinks.delete(el);
      }
    }
  }

  // ---------- 限時動態不自動播放 ----------
  // 播放器裡的每一則一出現就按 Instagram 自己的「暫停」：影片不會自己播，照片的進度條也不會跑，
  // 所以不會自己跳到下一則（要自己點左右換）。
  // 影片想看就按「播放」（使用者自己按的才算）；看到最後會在結束前停住，同樣不會自己跳到下一則。
  const PAUSE_LABEL_RE = /^(Pause|暫停)$/;
  const PLAY_LABEL_RE = /^(Play|播放)$/;
  let storyItem = null; // 目前這一則（圖片或影片的網址）
  let storyUserPlayed = false; // 這一則是使用者自己按了播放的影片
  const inStoryViewer = () => /^\/stories\//.test(location.pathname);
  function storyVideo() {
    return [...document.querySelectorAll("video")].find((v) => v.getBoundingClientRect().width > 100) || null;
  }
  function storyItemKey() {
    const v = storyVideo();
    if (v) return "v:" + (v.currentSrc || v.src || v.poster);
    const img = [...document.querySelectorAll("img")].find((i) => {
      const r = i.getBoundingClientRect();
      return r.width > 200 && r.height > 300;
    });
    return img ? "i:" + img.src : null;
  }
  function storyControl(re) {
    const svg = [...document.querySelectorAll("svg[aria-label]")].find(
      (sv) => re.test(sv.getAttribute("aria-label")) && sv.getBoundingClientRect().width > 0
    );
    return svg ? svg.closest('[role="button"], button') || svg.parentElement : null;
  }
  function holdStory() {
    if (!inStoryViewer()) return;
    const key = storyItemKey();
    if (!key) return;
    if (key !== storyItem) {
      storyItem = key;
      storyUserPlayed = false;
    }
    if (storyUserPlayed) return;
    const pause = storyControl(PAUSE_LABEL_RE);
    if (pause) pause.click();
  }
  // 使用者自己按「播放」（或空白鍵）：這一則影片讓它播
  document.addEventListener(
    "click",
    (e) => {
      if (!e.isTrusted || !inStoryViewer()) return;
      const play = storyControl(PLAY_LABEL_RE);
      if (play && (play === e.target || play.contains(e.target)) && storyVideo()) storyUserPlayed = true;
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.isTrusted && inStoryViewer() && e.key === " " && storyControl(PLAY_LABEL_RE) && storyVideo()) {
        storyUserPlayed = true;
      }
    },
    true
  );
  // 影片一開始播就檢查（不是使用者按的就馬上暫停）；快播完時停住，不讓它跳到下一則
  document.addEventListener("play", () => holdStory(), true);
  document.addEventListener(
    "timeupdate",
    (e) => {
      const v = e.target;
      if (!inStoryViewer() || !storyUserPlayed || v !== storyVideo() || !v.duration) return;
      if (v.currentTime >= v.duration - 0.35) storyControl(PAUSE_LABEL_RE)?.click();
    },
    true
  );

  // ---------- 主檢查 ----------
  // ---------- 對話框裡的直式影片放大 ----------
  // Instagram 的貼文對話框把影片放在 4:5 的框裡（padding-bottom 撐出比例的那層），
  // 9:16 的直式影片只能縮小塞進去，上下留一大塊黑邊。
  // 改成用影片自己的比例：框改成影片的比例，媒體欄寬度改成「欄高 × 影片寬高比」，讓影片填滿整個高度。
  // 影片尺寸要等 loadedmetadata 才知道；在那之前先把框藏起來，不會先看到黑邊再跳一下。
  // 輪播貼文（多張）不動，免得其他張的版面跑掉。
  const FIT_WAIT_MAX = 2000; // 影片資訊一直沒載入，最多藏這麼久
  function showBox(box) {
    if (box.style.visibility) box.style.removeProperty("visibility");
  }
  function fitDialogVideos() {
    for (const v of document.querySelectorAll('[role="dialog"] video')) {
      // 撐比例的那層：height 0、靠 padding-bottom 撐高
      let box = null;
      let col = null;
      let carousel = false;
      for (let e = v.parentElement; e && !e.matches('[role="dialog"]'); e = e.parentElement) {
        if (e.tagName === "LI") carousel = true;
        if (!box) {
          const pb = parseFloat(getComputedStyle(e).paddingBottom);
          if (pb > 0 && e.clientHeight - pb < 2) box = e;
          continue;
        }
        // 媒體欄：第一個比框高出不少的祖先
        if (e.getBoundingClientRect().height > box.getBoundingClientRect().height + 20) {
          col = e;
          break;
        }
      }
      if (!box || !col || carousel) {
        if (box) showBox(box);
        continue;
      }
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (!vw || !vh) {
        if (!box.dataset.igcWait) box.dataset.igcWait = String(Date.now());
        if (Date.now() - Number(box.dataset.igcWait) < FIT_WAIT_MAX) {
          box.style.setProperty("visibility", "hidden", "important");
        } else showBox(box);
        continue;
      }
      delete box.dataset.igcWait; // 下一篇貼文重用同一個框時重新計時
      const ratio = (vh / vw) * 100;
      const want = ratio.toFixed(3) + "%";
      if (box.dataset.igcFit !== want) {
        // 只放大直式影片：框本來就夠高（橫式、正方形）就不動
        const boxRatio = (parseFloat(getComputedStyle(box).paddingBottom) / box.clientWidth) * 100;
        if (ratio <= boxRatio + 1) {
          showBox(box);
          continue;
        }
        box.dataset.igcFit = want;
        box.style.setProperty("padding-bottom", want, "important");
      }
      const width = Math.floor((col.clientHeight * vw) / vh) + "px";
      if (col.style.maxWidth !== width) {
        col.style.setProperty("max-width", width, "important");
        col.style.setProperty("width", width, "important");
      }
      showBox(box);
    }
  }
  // 影片資訊一載入就馬上調整，不等下一次檢查（loadedmetadata 不會冒泡，要在捕獲階段聽）
  document.addEventListener(
    "loadedmetadata",
    (e) => {
      if (e.target.tagName === "VIDEO" && e.target.closest('[role="dialog"]')) fitDialogVideos();
    },
    true
  );

  function check() {
    const p = location.pathname;
    if (REELS_BLOCK_RE.test(p)) {
      location.replace("/");
      return;
    }
    const single = p.match(SINGLE_REEL_RE);
    if (single) {
      location.replace("/p/" + single[1] + "/");
      return;
    }
    if (POST_PAGE_RE.test(p)) hideMorePosts();
    if (p === "/") markSuggest();
    markDm();
    fitDialogVideos();
    const variant = new URLSearchParams(location.search).get("variant");
    // 首頁預設 = 只有限時動態；?variant=following（或 past_posts）= 貼文模式
    const storiesOnly = p === "/" && variant !== "following" && variant !== "past_posts";
    // 格狀版面：只在首頁「貼文」模式顯示。
    // 從格狀版面打開的貼文（Instagram 的對話框，網址暫時變成 /p/…）開著時保留，關掉後回到原本那一頁
    const postsMode = p === "/" && !storiesOnly;
    // 打開時網址先變、對話框晚一點才出現；關閉時對話框先消失、網址晚一點才變回來。
    // 這兩段空檔也要保留，否則格狀版面會被拿掉，回來時捲動位置歸零
    const now = Date.now();
    if (document.querySelector('[role="dialog"]')) dialogSeenAt = now;
    if (overlayPost && !overlayOn()) overlayPost = null;
    const overGrid =
      !postsMode &&
      POST_PAGE_RE.test(p) &&
      document.getElementById("igc-grid") &&
      (now - dialogSeenAt < 1000 || overlayOn());
    updateOverlay(!!overGrid && overlayOn());
    if (!postsMode && !overGrid) hideGrid();
    // 記下「從格狀版面打開的對話框」這一筆瀏覽紀錄（見 skipDialogEntry）
    if (overGrid && window.navigation && document.querySelector('[role="dialog"]')) {
      const key = navigation.currentEntry && navigation.currentEntry.key;
      if (key && !dialogEntries.has(key)) {
        dialogEntries.add(key);
        saveDialogEntries();
      }
    }
    const explore = /^\/explore\/?$/.test(p);
    const root = document.documentElement;
    // 必須在拿掉 class 之前標記，中間不能有一次重繪
    if (root.classList.contains("igc-explore") && !explore) linger(EXPLORE_GRID_SEL);
    // 首頁切到「貼文」模式（網址仍是 /）時不標記，那是使用者要看的
    // 從首頁點頭像打開限時動態播放器時（網址變 /stories/…），首頁還在播放器後面、播放器晚一點才出現；
    // 這段期間繼續用限時動態模式的版面，否則原本那一列限時動態和動態貼文會閃出來
    const storyViewer = /^\/stories\//.test(p);
    if (storiesOnly) viewerFromHome = true;
    else if (!storyViewer) viewerFromHome = false;
    const keepStories = storyViewer && viewerFromHome;
    if (root.classList.contains("igc-stories-only") && !storiesOnly && !keepStories && p !== "/") {
      linger(HOME_POSTS_SEL);
      markStale();
    }
    // 回到首頁：首頁的內容不用藏；其他頁面：時間到了就放開
    releaseStale(p === "/");
    root.classList.toggle("igc-explore", explore);
    root.classList.toggle("igc-stories-only", storiesOnly || keepStories);
    // 記錄目前被藏頁面上的連結；換到不同頁面就重新開始記
    const blockedPage = explore ? "explore" : storiesOnly ? "home" : null;
    if (blockedPage !== trackedPage) {
      seenLinks.clear();
      trackedPage = blockedPage;
    }
    if (explore) trackSeen(EXPLORE_GRID_SEL);
    else if (storiesOnly) trackSeen(HOME_POSTS_SEL);
    releaseLinger();
    // 先標記首頁貼文區塊，按鈕才能用它判斷首頁是否已載入
    if (storiesOnly) markHomePosts();
    else if (postsMode) {
      filterFeed();
      showGrid();
    }
    updateNav(p, storiesOnly);
    updateStories(p, storiesOnly);
    updateLoader();
    holdStory();
  }

  // 任何一次檢查出錯都只記錄下來，不能讓整個擋除功能停擺
  // （例如剛載入時 <body> 還不存在）。
  function safeCheck() {
    try {
      check();
    } catch (err) {
      console.error("[Doomn't]", err);
    }
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      safeCheck();
    });
  }

  // ---------- 動態裡的影片：點了不會開全螢幕 Reels 播放器 ----------
  // 影片外面包著 <a href="/reels/ID/">，點影片就會進入可以一直滑的播放器。
  // 在最早的捕獲階段攔下點擊；影片內的按鈕（靜音等）照常運作。
  // 只擋 /reels/…（播放器、音訊頁）；個人頁格狀的 /帳號/reel/ID/ 是單篇貼文頁，不擋。
  const REELS_LINK_RE = /^\/reels\/[^/]+/;
  function blockReelsClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const a = t.closest("a[href]");
    if (!a) return;
    let path;
    try {
      path = new URL(a.href, location.href).pathname;
    } catch {
      return;
    }
    if (!REELS_LINK_RE.test(path)) return;
    const btn = t.closest("button, [role='button']");
    if (btn && a.contains(btn)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  for (const type of ["click", "auxclick"]) {
    window.addEventListener(type, blockReelsClick, true);
  }

  // ---------- 返回時跳過對話框那一筆紀錄 ----------
  // 從格狀版面打開貼文（網址變 /p/…），在對話框裡點進某人的個人頁、Reels，再按上一頁回來時，
  // 會先回到 /p/… 那一筆；Instagram 這時不會再開對話框，而是顯示整頁貼文，格狀版面就不見了。
  // 記下這些紀錄（navigation entry 的 key，存在 sessionStorage，重新整理也記得），
  // 回到其中一筆時自動再往同一個方向走一步：上一頁 → 直接回到格狀版面。
  const DIALOG_ENTRIES_KEY = "igcDialogEntries";
  let dialogEntries;
  try {
    dialogEntries = new Set(JSON.parse(sessionStorage.getItem(DIALOG_ENTRIES_KEY) || "[]"));
  } catch {
    dialogEntries = new Set();
  }
  function saveDialogEntries() {
    try {
      sessionStorage.setItem(DIALOG_ENTRIES_KEY, JSON.stringify([...dialogEntries].slice(-50)));
    } catch {}
  }
  function skipDialogEntry(e) {
    if (e.navigationType !== "traverse") return;
    const cur = navigation.currentEntry;
    if (!cur || !dialogEntries.has(cur.key)) return;
    const back = e.from && e.from.index > cur.index;
    if (back && navigation.canGoBack) navigation.back();
    else if (!back && navigation.canGoForward) navigation.forward();
  }
  if (window.navigation) navigation.addEventListener("currententrychange", skipDialogEntry);

  // 先掛好輪詢與監聽，最後才做第一次檢查
  setInterval(safeCheck, 250);
  window.addEventListener("popstate", safeCheck);
  // 網址一變（包含 Instagram 內部的 pushState）就立刻檢查，不等下一次輪詢
  if (window.navigation) navigation.addEventListener("currententrychange", safeCheck);
  new MutationObserver(() => {
    // 對話框影片要在第一次畫出來之前就藏好，不能等 requestAnimationFrame
    if (document.querySelector('[role="dialog"] video')) fitDialogVideos();
    // 限時動態的下一則一出現就暫停，不等下一次檢查
    if (inStoryViewer()) holdStory();
    schedule();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  safeCheck();
})();
