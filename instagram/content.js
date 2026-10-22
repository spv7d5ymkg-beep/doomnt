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

  // ---------- 首頁「貼文」模式：分頁，每頁 10 篇 ----------
  // Instagram 會把捲過去的貼文從頁面上移除（只留空白佔位），所以不能數頁面上有幾個 <article>，
  // 而是依照「第一次出現的順序」記下每篇貼文的 ID，只顯示目前這一頁的 10 篇。
  //
  // 其他頁的貼文用 visibility: hidden 藏起來：看不見，但保留原本的高度。
  // 不能用 display: none：Instagram「只顯示畫面附近貼文」的機制仍以為它們有高度，
  // 位置算錯，捲到底會一直把畫面往上推、翻頁後頂端一片空白。
  // 因為其他頁的貼文還佔著位置，所以限制捲動範圍：
  // 往上最多到本頁第一篇（第 1 頁不限制），往下最多到分頁按鈕完整出現。
  // 捲不到後面看不見的貼文，Instagram 也就不會再往下載入。
  // 分頁按鈕不能放進 Instagram 的貼文清單裡：它照清單裡的元素逐個對應貼文，
  // 多一個元素就算錯要顯示哪幾篇（會一直停在同幾篇、下面留一大片空白）。
  // 所以按鈕放在 <body> 上，用絕對定位對齊本頁最後一篇的正下方。
  // 廣告、建議貼文已被 filterFeed 藏起來，不算在內。重新整理或重新進入這一頁就回到第 1 頁。
  const PAGE_SIZE = 10;
  let feedHref = null; // 正在分頁的頁面網址
  let feedOrder = []; // 依第一次出現順序排列的貼文 ID
  let feedPage = 0; // 目前在第幾頁（從 0 開始）
  let pageFirst = null; // 本頁第一篇（在頁面上時）
  let pageLast = null; // 本頁最後一篇（本頁已滿、在頁面上時）：分頁按鈕對齊它的正下方
  let jumping = false; // 翻頁捲動中：暫停捲動限制

  function postId(article) {
    const a = article.querySelector('a[href*="/p/"], a[href*="/reel/"]');
    const m = a && a.getAttribute("href").match(/\/(?:p|reel)\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  // 翻頁：重新分類後捲到新一頁的第一篇。那一篇可能已被 Instagram 移除（往前翻時），
  // 就往那個方向一段一段捲，直到它重新出現。
  async function goToPage(page) {
    const forward = page > feedPage;
    feedPage = Math.max(0, page);
    barMin = barMax = null;
    jumping = true;
    try {
      paginateFeed();
      if (feedPage === 0) {
        window.scrollTo(0, 0);
        return;
      }
      for (let i = 0; i < 60 && !(pageFirst && pageFirst.isConnected); i++) {
        window.scrollBy(0, forward ? window.innerHeight : -window.innerHeight);
        await new Promise((r) => setTimeout(r, 100));
        paginateFeed();
      }
      if (pageFirst && pageFirst.isConnected) {
        window.scrollTo(0, pageTop(pageFirst));
      }
    } finally {
      jumping = false;
      updateBar();
    }
  }

  // 本頁第一篇上方留一點空間的位置
  function pageTop(el) {
    return Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY - 24));
  }

  // 把分頁按鈕對齊本頁最後一篇的正下方；那一篇不在頁面上就藏起來
  function placePager() {
    const pager = document.getElementById("igc-pager");
    if (!pager) return null;
    if (!pageLast || !pageLast.isConnected) {
      pager.hidden = true;
      return pager;
    }
    const r = pageLast.getBoundingClientRect();
    pager.style.top = Math.round(r.bottom + window.scrollY) + "px";
    pager.style.left = Math.round(r.left + window.scrollX) + "px";
    pager.style.width = Math.round(r.width) + "px";
    pager.hidden = false;
    return pager;
  }

  // 滑鼠滾輪連續捲動時，Chrome 會把它當成同一段手勢：第一下沒被取消，後面每一下都不能取消。
  // 這時改成暫時鎖住整個頁面的捲動（overflow: hidden）並停在邊界，滾輪停下一下子再解鎖。
  let lockTimer = 0;
  function lockScroll() {
    document.documentElement.classList.add("igc-scroll-lock");
    clearTimeout(lockTimer);
    lockTimer = setTimeout(unlockScroll, 250);
  }
  function unlockScroll() {
    clearTimeout(lockTimer);
    document.documentElement.classList.remove("igc-scroll-lock");
  }

  // 捲動範圍：往上最多到本頁第一篇（第 1 頁不限制），往下最多到分頁按鈕完整出現。
  // 每次都用當下的位置計算（Instagram 會隨時調整預留空白，位置會變）。
  function scrollRange() {
    let min = null;
    let max = null;
    if (feedPage > 0 && pageFirst && pageFirst.isConnected && !pageFirst.closest(".igc-other-page")) {
      min = pageTop(pageFirst);
    }
    const pager = placePager();
    if (pager && !pager.hidden) {
      max = Math.max(0, Math.round(pager.getBoundingClientRect().bottom + window.scrollY + 48 - window.innerHeight));
    }
    return { min, max };
  }

  // 捲到頂或底就直接停住：在捲動發生之前判斷，這一下會超過範圍就取消，只捲到邊界為止。
  // （如果先讓瀏覽器捲過頭再拉回來，就會感覺被推回去。）
  function stopAtEdge(e, delta) {
    if (jumping || delta === 0) return false;
    const { min, max } = scrollRange();
    const y = window.scrollY;
    let edge = null;
    if (delta > 0 && max !== null && y + delta > max) edge = max;
    else if (delta < 0 && min !== null && y + delta < min) edge = min;
    if (edge === null) return false;
    if (e.cancelable) e.preventDefault();
    else lockScroll();
    // 還沒到邊界：補捲到邊界為止。已經超過邊界（例如第 10 篇的圖片載入後變矮、分頁按鈕往上移）：
    // 停在原地，不要把畫面拉回去，否則看起來像被推回一小段
    if (delta > 0 ? y < edge : y > edge) window.scrollTo({ top: edge, behavior: "instant" });
    return true;
  }

  // 滑鼠滾輪、觸控板。
  // 能取消的滾輪事件：這一下會超過邊界就取消，補捲到邊界為止（stopAtEdge）。
  // 不能取消的（連續滾動的同一段手勢）：Chrome 會在自己的捲動執行緒先捲出去，來不及攔。
  // 所以離邊界只剩約 3 格時就提前鎖住頁面捲動，改由這裡一格一格捲，最多剛好捲到邊界，
  // 不會先捲出去再被拉回來。
  const WHEEL_LOOKAHEAD = 3;
  function wheelAtEdge(e, delta) {
    if (jumping || delta === 0) return false;
    const { min, max } = scrollRange();
    const towardMax = delta > 0 && max !== null;
    const towardMin = delta < 0 && min !== null;
    if (!towardMax && !towardMin) return false;
    const edge = towardMax ? max : min;
    const y = window.scrollY;
    const dist = towardMax ? edge - y : y - edge; // 離邊界還有多遠（負數 = 已經超過）
    const step = Math.abs(delta);
    if (dist > step * WHEEL_LOOKAHEAD) return false; // 離邊界還遠：照常捲（呼叫端會解鎖）
    const locked = document.documentElement.classList.contains("igc-scroll-lock");
    if (e.cancelable && !locked) return stopAtEdge(e, delta);
    if (e.cancelable) e.preventDefault();
    lockScroll();
    if (dist > 0) {
      const target = towardMax ? Math.min(y + step, edge) : Math.max(y - step, edge);
      window.scrollTo({ top: target, behavior: "instant" });
    }
    return true;
  }

  window.addEventListener(
    "wheel",
    (e) => {
      if (e.ctrlKey) return; // 縮放手勢
      // 留言等對話框裡可以自己捲動，不要擋
      if (e.target.closest && e.target.closest("[role='dialog']")) return;
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1;
      // 往離開邊界的方向捲：馬上解鎖
      if (!wheelAtEdge(e, e.deltaY * unit)) unlockScroll();
    },
    { passive: false, capture: true }
  );

  // 鍵盤：↑↓、Page Up/Down、空白鍵、Home/End（在輸入框裡打字時不處理）
  window.addEventListener(
    "keydown",
    (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (t && t.closest && t.closest("[role='dialog']")) return;
      const page = window.innerHeight * 0.875;
      const delta = {
        ArrowDown: 40,
        ArrowUp: -40,
        PageDown: page,
        PageUp: -page,
        " ": e.shiftKey ? -page : page,
        End: Infinity,
        Home: -Infinity,
      }[e.key];
      if (delta !== undefined) stopAtEdge(e, delta);
    },
    { capture: true }
  );

  // 保險：拖曳捲軸等無法事先攔下的捲動，往外捲過邊界就擋下。
  // 只擋「越捲越遠」：停在邊界或原本的位置（取比較靠外的那個），不會把畫面往回拉。
  let lastScrollY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      if (!jumping) {
        const { min, max } = scrollRange();
        if (max !== null && y > max && y > lastScrollY) {
          window.scrollTo({ top: Math.max(max, lastScrollY), behavior: "instant" });
        } else if (min !== null && y < min && y < lastScrollY) {
          window.scrollTo({ top: Math.min(min, lastScrollY), behavior: "instant" });
        }
      }
      lastScrollY = window.scrollY;
    },
    { passive: true }
  );

  // ---------- 自訂捲軸：只代表目前這一頁 ----------
  // Instagram 的動態是一條很長的清單（只顯示畫面附近的貼文），沒辦法真的切成獨立的頁面，
  // 瀏覽器的捲軸會反映整條清單的位置，翻頁後不會回到最上面。
  // 所以在「貼文」模式藏起瀏覽器的捲軸（style.css），改顯示這個捲軸：
  // 頂端 = 本頁第一篇（第 1 頁是頁面最上方），底端 = 分頁按鈕完整出現的位置。
  // 本頁第一篇或分頁按鈕不在頁面上時，用最後一次量到的位置。
  let barMin = null; // 本頁可捲範圍的頂端（頁面座標）
  let barMax = null; // 本頁可捲範圍的底端
  let barGeom = null; // 最後一次畫捲軸時的 { lo, hi, track, thumbH }
  let barPending = false;

  function ensureBar() {
    let bar = document.getElementById("igc-scrollbar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "igc-scrollbar";
    const thumb = document.createElement("div");
    thumb.id = "igc-scrollbar-thumb";
    bar.appendChild(thumb);
    // 拖曳滑桿
    thumb.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || !barGeom) return;
      e.preventDefault();
      e.stopPropagation();
      const { lo, hi, track, thumbH } = barGeom;
      const startY = e.clientY;
      const startScroll = window.scrollY;
      const perPx = (hi - lo) / Math.max(1, track - thumbH);
      bar.classList.add("igc-dragging");
      const move = (ev) => {
        const y = Math.min(hi, Math.max(lo, startScroll + (ev.clientY - startY) * perPx));
        window.scrollTo({ top: y, behavior: "instant" });
      };
      const up = () => {
        bar.classList.remove("igc-dragging");
        window.removeEventListener("mousemove", move, true);
        window.removeEventListener("mouseup", up, true);
      };
      window.addEventListener("mousemove", move, true);
      window.addEventListener("mouseup", up, true);
    });
    // 點滑桿以外的地方：往那個方向捲一個畫面
    bar.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target !== bar || !barGeom) return;
      e.preventDefault();
      const thumbTop = thumb.getBoundingClientRect().top;
      const step = window.innerHeight * 0.9 * (e.clientY < thumbTop ? -1 : 1);
      const { lo, hi } = barGeom;
      window.scrollTo({ top: Math.min(hi, Math.max(lo, window.scrollY + step)), behavior: "instant" });
    });
    document.body.appendChild(bar);
    return bar;
  }

  function updateBar() {
    if (!document.body || !document.documentElement.classList.contains("igc-paged")) return;
    if (jumping) return; // 翻頁捲動中，翻完再畫
    const bar = ensureBar();
    const thumb = bar.firstElementChild;
    const { min, max } = scrollRange();
    if (min !== null) barMin = min;
    if (max !== null) barMax = max;
    const lo = feedPage === 0 ? 0 : barMin !== null ? barMin : 0;
    const docMax = document.documentElement.scrollHeight - window.innerHeight;
    const hi = Math.max(lo, barMax !== null ? barMax : docMax);
    const span = Math.max(1, hi - lo);
    const track = bar.clientHeight;
    const thumbH = Math.min(track, Math.max(40, (track * window.innerHeight) / (span + window.innerHeight)));
    const ratio = Math.min(1, Math.max(0, (window.scrollY - lo) / span));
    thumb.style.height = Math.round(thumbH) + "px";
    thumb.style.transform = "translateY(" + Math.round(ratio * (track - thumbH)) + "px)";
    barGeom = { lo, hi, track, thumbH };
  }

  function scheduleBar() {
    if (barPending) return;
    barPending = true;
    requestAnimationFrame(() => {
      barPending = false;
      updateBar();
    });
  }
  window.addEventListener("scroll", scheduleBar, { passive: true });
  window.addEventListener("resize", scheduleBar);

  function createPager() {
    const pager = document.createElement("nav");
    pager.id = "igc-pager";
    pager.innerHTML =
      '<button type="button" data-go="-1">← 上一頁</button>' +
      "<span></span>" +
      '<button type="button" data-go="1">下一頁 →</button>';
    pager.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-go]");
      if (btn && !btn.disabled) goToPage(feedPage + Number(btn.dataset.go));
    });
    return pager;
  }

  function paginateFeed() {
    if (feedHref !== location.href) {
      feedHref = location.href;
      barMin = barMax = null;
      feedOrder = [];
      feedPage = 0;
    }
    const start = feedPage * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    // 廣告、建議貼文有時要等內容載入後才認得出來、被 filterFeed 藏起來；
    // 已經算進去的就拿掉，後面的貼文往前遞補，否則那一篇的位置會空著、分頁按鈕出不來
    for (const a of document.querySelectorAll("main article.igc-hidden")) {
      const i = feedOrder.indexOf(postId(a));
      if (i !== -1) feedOrder.splice(i, 1);
    }
    const articles = [...document.querySelectorAll("main article")].filter(
      (a) => !a.classList.contains("igc-hidden")
    );
    let lastOnPage = null; // 本頁在頁面上的最後一篇
    let lastRank = -1;
    pageFirst = null;
    pageLast = null;
    for (const a of articles) {
      const id = postId(a);
      let rank = id ? feedOrder.indexOf(id) : -1;
      if (id && rank === -1) {
        rank = feedOrder.length;
        feedOrder.push(id);
      }
      // 還沒載入完、看不出是哪一篇：這一頁還沒滿就當成本頁，滿了就當成後面的頁
      if (!id) rank = feedOrder.length < end ? start : end;
      const onPage = rank >= start && rank < end;
      a.classList.toggle("igc-other-page", !onPage);
      a.dataset.igcRank = rank;
      if (onPage && id && rank === start) pageFirst = a;
      if (onPage && rank >= lastRank) {
        lastRank = rank;
        lastOnPage = a;
      }
    }

    document.documentElement.classList.add("igc-paged");
    scheduleBar();
    const pager = document.getElementById("igc-pager") || createPager();
    const pageFull = feedOrder.length >= end;
    const feedEnded = !!findText(document.body, MARKER_RE); // 「沒有其他新動態了」
    const lastPage = feedEnded && feedOrder.length <= end;
    // 本頁已滿（或已是最後一頁）而且最後一篇在頁面上：分頁按鈕對齊它的正下方
    if (!pager.isConnected) document.body.appendChild(pager);
    if (lastOnPage && (pageFull || lastPage) && lastRank === Math.min(end, feedOrder.length) - 1) {
      pageLast = lastOnPage;
      placePager();
    } else {
      pager.hidden = true;
      // 保險：本頁已滿，但畫面上只剩後面頁（看不見）的貼文，表示已經捲過頭了：
      // 往回捲一段，直到本頁最後一篇和分頁按鈕重新出現
      if (pageFull && !jumping) {
        const inView = articles.filter((a) => {
          const r = a.getBoundingClientRect();
          return r.bottom > 0 && r.top < window.innerHeight;
        });
        if (inView.length && inView.every((a) => Number(a.dataset.igcRank) >= end)) {
          window.scrollBy(0, -window.innerHeight);
        }
      }
    }

    const [prev, label, next] = pager.children;
    prev.disabled = feedPage === 0;
    label.textContent = "第 " + (feedPage + 1) + " 頁";
    next.disabled = !pageFull || lastPage;
    next.textContent = lastPage ? "沒有更多貼文了" : "下一頁 →";
  }

  // ---------- 首頁「貼文」模式：隱藏上方的「← 追蹤中」標題 ----------
  // 我們的切換按鈕已經能切換模式，Instagram 自己的標題（返回首頁的連結）就不需要了。
  // 只在 <main> 裡找：頁面剛載入時 Instagram 會先把內容放在隱藏的暫存區塊，不要動到那裡，
  // 也不會找到側邊欄等其他地方的「追蹤中」。
  // 從文字往上找，取「只含這個標題列」的最外層：不含貼文、不含我們的切換按鈕、文字很短。
  // 回傳被藏起來的標題區塊（切換按鈕會放在它的位置），找不到則回傳 null。
  const FOLLOWING_RE = /^(追蹤中|Following)$/;
  function hideFollowingHeader() {
    const main = document.querySelector("main");
    if (!main) return null;
    const w = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (!FOLLOWING_RE.test(n.textContent.trim())) continue;
      let el = n.parentElement;
      if (el.closest("article, #igc-toggle")) continue; // 貼文裡的「追蹤中」按鈕不算
      let block = el;
      for (el = el.parentElement; el && el !== main; el = el.parentElement) {
        if (el.querySelector("article, #igc-toggle, canvas")) break;
        if (el.textContent.trim().length > 20) break;
        block = el;
      }
      hide(block);
      return block;
    }
    return null;
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
  const POSTERS = ["poster-1.png", "poster-2.png", "poster-3.png", "poster-4.png"];
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

  function updateToggle(p, storiesOnly, header) {
    const showing = homeShowing(p, storiesOnly);
    togglePath = p;
    toggleStoriesOnly = storiesOnly;
    let box = document.getElementById("igc-toggle");
    if (!showing) {
      if (box) box.remove();
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
    // 限時動態模式：限時動態列上方；貼文模式：被藏起來的「← 追蹤中」標題的位置（沒有就放第一篇貼文上方）
    const spot = storiesOnly ? toggleSpot(homeAnchor) : header || homeAnchor;
    if (box.nextElementSibling !== spot) spot.before(box);
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
    // 分頁按鈕掛在 <body> 上：離開首頁「貼文」模式就移除
    if (p !== "/" || storiesOnly) {
      const pager = document.getElementById("igc-pager");
      if (pager) pager.remove();
      document.documentElement.classList.remove("igc-scroll-lock", "igc-paged");
    }
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
    let header = null;
    if (storiesOnly) markHomePosts();
    else if (p === "/") {
      filterFeed();
      paginateFeed();
      header = hideFollowingHeader();
    }
    updateToggle(p, storiesOnly, header);
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
