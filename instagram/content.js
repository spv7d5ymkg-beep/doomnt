(function () {
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
  let openedAt = 0; // 最近一次從格狀版面打開貼文的時間
  let dialogSeenAt = 0; // 最近一次看到貼文對話框的時間

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
    for (const a of document.querySelectorAll("main article")) {
      const id = postId(a);
      if (!id) continue;
      let p = postById.get(id);
      if (a.classList.contains("igc-hidden")) {
        // 內容載入後才認出是廣告：拿掉，後面的往前遞補
        if (p) {
          posts = posts.filter((x) => x !== p);
          postById.delete(id);
        }
        continue;
      }
      if (!p) {
        p = { id };
        postById.set(id, p);
        posts.push(p);
      }
      p.img = coverImage(a) || p.img;
      p.user = postUser(a) || p.user;
      Object.assign(p, readCounts(a));
      p.video = p.video || !!a.querySelector("video");
      p.carousel =
        p.carousel || !!a.querySelector('button[aria-label="下一步"], button[aria-label="Next"]');
      const t = a.querySelector("time[datetime]");
      if (t) p.time = Date.parse(t.getAttribute("datetime"));
      p.y = Math.round(a.getBoundingClientRect().top + window.scrollY);
    }
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
      for (let i = 0; i < 250 && posts.length < n && !stopLoading; i++) {
        collect();
        if (posts.length >= n || feedEnded()) break;
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        await sleep(120);
        renderGrid();
      }
      collect();
    } finally {
      busy = false;
      renderGrid();
    }
  }

  function findArticle(id) {
    return [...document.querySelectorAll("main article")].find((a) => postId(a) === id) || null;
  }

  // 打開貼文：背景動態捲到那一篇（Instagram 只留畫面附近的貼文），再按它的「回應」按鈕
  async function openPost(id) {
    const p = postById.get(id);
    if (!p || stopLoading) return;
    // 背景還在載入下一頁：先停下來（最多等一下子），再去找這一篇
    stopLoading = true;
    for (let i = 0; busy && i < 20; i++) await sleep(50);
    stopLoading = false;
    if (busy) return;
    busy = true;
    try {
      let art = findArticle(id);
      if (!art && p.y !== undefined) {
        window.scrollTo(0, Math.max(0, p.y - 100));
        await sleep(150);
        art = findArticle(id);
      }
      // 還是不在：看頁面上的貼文排在它前面還是後面，往那個方向找
      const idx = posts.indexOf(p);
      for (let i = 0; !art && i < 60; i++) {
        const shown = [...document.querySelectorAll("main article")]
          .map((a) => posts.indexOf(postById.get(postId(a))))
          .filter((x) => x >= 0);
        const down = !shown.length || Math.max(...shown) < idx;
        window.scrollBy(0, (down ? 1 : -1) * Math.round(window.innerHeight * 0.8));
        await sleep(120);
        art = findArticle(id);
      }
      collect();
      const icon =
        art &&
        [...art.querySelectorAll("section svg[aria-label]")].find((s) =>
          COMMENT_LABEL_RE.test(s.getAttribute("aria-label"))
        );
      const btn = icon && (icon.closest('[role="button"], button, a') || icon.parentElement);
      if (btn) {
        openedAt = Date.now();
        btn.click();
      }
      else location.assign("/p/" + id + "/"); // 關閉留言的貼文沒有「回應」按鈕：改開貼文頁
    } finally {
      busy = false;
    }
  }

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
      '<nav id="igc-pager"><button type="button" data-go="-1">← 上一頁</button><span></span>' +
      '<button type="button" data-go="1">下一頁 →</button></nav></div>';
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
  function placeGrid(grid) {
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
    grid.style.left = (right ? sidebarMin : 0) + "px";
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

  function renderGrid() {
    const grid = document.getElementById("igc-grid");
    if (!grid) return;
    placeGrid(grid);
    const start = feedPage * PAGE_SIZE;
    const items = posts.slice(start, start + PAGE_SIZE);
    const ended = feedEnded();
    const loadingPage = items.length < PAGE_SIZE && !ended;
    const midnight = new Date().setHours(0, 0, 0, 0);
    const sig = JSON.stringify([feedPage, ended, loadingPage, midnight, items]);
    if (sig === gridSig) return;
    gridSig = sig;

    let html = "";
    for (const p of items) html += tileHtml(p, midnight);
    if (loadingPage) html += '<div class="igc-grid-loading">載入中…</div>';
    else if (!items.length) html += '<div class="igc-grid-loading">沒有更多貼文了</div>';
    grid.querySelector("#igc-grid-tiles").innerHTML = html;

    const [prev, label, next] = grid.querySelector("#igc-pager").children;
    const lastPage = ended && posts.length <= start + PAGE_SIZE;
    prev.disabled = feedPage === 0;
    label.textContent = "第 " + (feedPage + 1) + " 頁";
    next.disabled = lastPage || loadingPage;
    next.textContent = lastPage ? "沒有更多貼文了" : "下一頁 →";
  }

  function showGrid() {
    if (feedHref !== location.href) {
      feedHref = location.href;
      feedPage = 0;
      posts = [];
      postById = new Map();
      gridSig = "";
    }
    document.documentElement.classList.add("igc-grid");
    ensureGrid();
    pauseHiddenVideos();
    collect();
    renderGrid();
    // 本頁和下一頁還沒載滿：在背景繼續捲動載入
    if (!busy && !feedEnded() && posts.length < (feedPage + 1 + PREFETCH_PAGES) * PAGE_SIZE) {
      loadUntil((feedPage + 1 + PREFETCH_PAGES) * PAGE_SIZE);
    }
  }

  function hideGrid() {
    const grid = document.getElementById("igc-grid");
    if (grid) grid.remove();
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
      // 往上找到第一個含有貼文連結的區塊（標題 + 影片牆），整塊隱藏
      let el = n.parentElement;
      for (let i = 0; i < 6 && el && el !== document.body; i++) {
        if (el.querySelector('a[href*="/p/"], a[href*="/reel/"]')) {
          if (!el.querySelector("video")) hide(el); // 保險：不要連正在看的影片一起藏
          break;
        }
        el = el.parentElement;
      }
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
          addMeme(el);
          return;
        }
      }
      el = el.parentElement;
    }
  }

  // ---------- 限時動態下方的空白處：放一張圖 ----------
  // 插在被隱藏的貼文區塊後面；只在「限時動態」模式由 CSS 顯示。
  // 每次載入頁面隨機選一張
  const POSTERS = ["poster-1.png", "poster-2.png", "poster-3.png", "poster-4.png", "poster-5.png", "poster-6.png", "poster-7.png", "poster-8.png"];
  const poster = POSTERS[Math.floor(Math.random() * POSTERS.length)];

  function addMeme(postsBlock) {
    let box = document.getElementById("igc-meme");
    if (box && box.previousElementSibling === postsBlock) return;
    if (!box) {
      box = document.createElement("div");
      box.id = "igc-meme";
      const img = document.createElement("img");
      img.src = chrome.runtime.getURL("images/" + poster);
      img.alt = "";
      img.draggable = false;
      box.appendChild(img);
    }
    postsBlock.after(box);
  }

  // ---------- 切換按鈕：限時動態 / 貼文 ----------
  // 按鈕跟著首頁內容出現與消失，而不是只看網址：
  // Instagram 換頁時網址先變，新頁面晚一點才載入，舊頁面也會多留一下。
  // - 回到首頁：要等到「回來之後才出現的」首頁貼文出現，按鈕才顯示
  //   （回來那一刻已經在畫面上的 <article> 屬於上一頁，不算）。
  //   例外：之前在首頁就看過的貼文。看限時動態時，播放器是蓋在首頁上面的，
  //   首頁的貼文一直都在；關掉播放器回來時，它們仍然是首頁內容，按鈕要馬上出現。
  // - 離開首頁：首頁內容還在畫面上時按鈕繼續留著，最多 LINGER_MS。
  let togglePath = null; // 上一次檢查時的路徑
  let toggleStoriesOnly = null; // 上一次檢查時是不是限時動態模式
  let staleArticles = new WeakSet(); // 回到首頁那一刻就已存在、而且不是首頁的 <article>
  const homeArticles = new WeakSet(); // 在首頁上看過的 <article>
  let homeAnchor = null; // 目前代表「首頁已載入」的貼文節點
  let leftHomeAt = 0;

  function homeShowing(p, storiesOnly) {
    if (p === "/") {
      // 同一個網址 / 下切換模式（例如點「← 追蹤中」回到限時動態）：重新找代表首頁的貼文
      if (togglePath === "/" && toggleStoriesOnly !== storiesOnly) homeAnchor = null;
      if (togglePath !== "/") {
        // 剛打開分頁（togglePath 還是 null）時沒有上一頁，畫面上的都是首頁內容
        staleArticles = new WeakSet();
        if (togglePath !== null) {
          for (const a of document.querySelectorAll("article")) {
            if (!homeArticles.has(a)) staleArticles.add(a);
          }
        }
        homeAnchor = null;
      }
      if (!homeAnchor || !homeAnchor.isConnected) {
        // 限時動態模式：markHomePosts 標記好的貼文區塊；貼文模式：動態裡的貼文
        const sel = storiesOnly ? ".igc-home-posts article" : "main article";
        homeAnchor = [...document.querySelectorAll(sel)].find((a) => !staleArticles.has(a)) || null;
      }
      if (!homeAnchor) return false;
      // 首頁已載入：記下目前首頁上的貼文（上一頁留下的不算）
      for (const a of document.querySelectorAll("main article")) {
        if (!staleArticles.has(a)) homeArticles.add(a);
      }
      return true;
    }
    if (togglePath === "/") leftHomeAt = Date.now();
    if (homeAnchor && homeAnchor.isConnected && Date.now() - leftHomeAt < LINGER_MS) return true;
    homeAnchor = null;
    return false;
  }

  // 按鈕放在首頁內容裡、限時動態列的上方（不再固定浮在畫面上，才不會蓋住通知等側欄面板）。
  // 從首頁貼文往上找，找到「前面有兄弟含 <canvas>」的那一層：那個兄弟就是限時動態列。
  // 找不到限時動態列（例如貼文模式沒有它）時，放在第一篇貼文上方。
  function toggleSpot(anchor) {
    let el = anchor;
    while (el.parentElement && el.parentElement !== document.body && el.parentElement.tagName !== "MAIN") {
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.id !== "igc-toggle" && sib.querySelector("canvas")) return sib;
      }
      el = el.parentElement;
    }
    return anchor;
  }

  function updateToggle(p, storiesOnly) {
    const showing = homeShowing(p, storiesOnly);
    togglePath = p;
    toggleStoriesOnly = storiesOnly;
    let box = document.getElementById("igc-toggle");
    if (!showing) {
      // 格狀版面上的按鈕跟著格狀版面（打開貼文對話框時格狀版面還在，按鈕也留著，版面才不會移動）
      if (box && !box.closest("#igc-grid")) box.remove();
      return;
    }
    // 離開首頁、舊內容還在時：按鈕就在舊首頁裡，跟著它一起消失；維持原本的選取狀態
    if (p !== "/") return;
    if (!box) {
      box = document.createElement("div");
      box.id = "igc-toggle";
      box.innerHTML =
        '<a data-mode="stories" href="/">限時動態</a>' +
        '<a data-mode="posts" href="/?variant=following">貼文</a>';
    }
    box.hidden = false;
    if (!storiesOnly) {
      // 貼文模式：格狀版面的最上方
      const head = document.getElementById("igc-grid-head");
      if (head && box.parentElement !== head) head.appendChild(box);
    } else {
      // 限時動態模式：限時動態列上方
      const spot = toggleSpot(homeAnchor);
      if (box.nextElementSibling !== spot) spot.before(box);
    }
    const mode = storiesOnly ? "stories" : "posts";
    for (const a of box.querySelectorAll("a")) {
      a.classList.toggle("igc-active", a.dataset.mode === mode);
    }
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

  // ---------- 主檢查 ----------
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
    const overGrid =
      !postsMode &&
      POST_PAGE_RE.test(p) &&
      document.getElementById("igc-grid") &&
      (now - dialogSeenAt < 1000 || now - openedAt < 3000);
    if (!postsMode && !overGrid) hideGrid();
    const explore = /^\/explore\/?$/.test(p);
    const root = document.documentElement;
    // 必須在拿掉 class 之前標記，中間不能有一次重繪
    if (root.classList.contains("igc-explore") && !explore) linger(EXPLORE_GRID_SEL);
    // 首頁切到「貼文」模式（網址仍是 /）時不標記，那是使用者要看的
    if (root.classList.contains("igc-stories-only") && !storiesOnly && p !== "/") {
      linger(HOME_POSTS_SEL);
    }
    root.classList.toggle("igc-explore", explore);
    root.classList.toggle("igc-stories-only", storiesOnly);
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
    updateToggle(p, storiesOnly);
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

  // 先掛好輪詢與監聽，最後才做第一次檢查
  setInterval(safeCheck, 250);
  window.addEventListener("popstate", safeCheck);
  // 網址一變（包含 Instagram 內部的 pushState）就立刻檢查，不等下一次輪詢
  if (window.navigation) navigation.addEventListener("currententrychange", safeCheck);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  safeCheck();
})();
