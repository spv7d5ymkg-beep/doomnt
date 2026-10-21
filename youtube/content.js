(function () {
  // ---------- 首頁空白處的圖片：每次載入頁面隨機一張 ----------
  // style.css 用 --ytc-home-img 當首頁的背景圖
  const POSTERS = ["poster-1.png", "poster-2.png", "poster-3.png", "poster-4.png"];
  const poster = POSTERS[Math.floor(Math.random() * POSTERS.length)];
  document.documentElement.style.setProperty(
    "--ytc-home-img",
    'url("' + chrome.runtime.getURL("images/" + poster) + '")'
  );

  // ---------- 路徑規則 ----------
  const SHORTS_RE = /^\/shorts\/([\w-]+)/; // /shorts/影片ID → 改開一般播放頁
  const CHANNEL_SHORTS_RE = /^(\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+))\/shorts\/?$/; // 頻道 Shorts 分頁
  const BLOCK_RE = /^\/(feed\/(trending|explore)|gaming)(\/|$)/; // 探索類頁面

  function redirectTarget(p) {
    let m = p.match(SHORTS_RE);
    if (m) return "/watch?v=" + m[1];
    m = p.match(CHANNEL_SHORTS_RE);
    if (m) return m[1];
    if (BLOCK_RE.test(p)) return "/";
    return null;
  }

  // ---------- 點擊 Shorts 連結：直接改開一般播放頁，避免先載入 Shorts 播放器 ----------
  window.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a) return;
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (url.hostname !== location.hostname) return;
      const t = redirectTarget(url.pathname);
      if (!t) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      location.assign(t);
    },
    true
  );

  // ---------- 側邊欄探索區（用 JS 判斷，不只靠 CSS :has） ----------
  // 首次載入時 Chrome 不一定會重新套用 :has()，所以每次檢查都直接標記
  const EXPLORE_PATH_RE = /^\/(feed\/(trending|explore|storefront|courses_destination)|gaming|podcasts|channel\/(UC-9-kyTW8ZkZNDHQJ6FgpwQ|UC4R8DWoMoI7CAwX8_LjQHig|UCYfdidRxbB8Qhf0Nx7ioOYw|UCEgdi0XIXXZ-qJOFPf4JSKw))(\/|$)/;
  const EXPLORE_TITLE_RE = /^(探索|Explore)$/;

  function isExploreSection(sec) {
    const title = sec.querySelector("#guide-section-title");
    if (title && EXPLORE_TITLE_RE.test(title.textContent.trim())) return true;
    for (const a of sec.querySelectorAll("a[href]")) {
      if (a.hostname === location.hostname && EXPLORE_PATH_RE.test(a.pathname)) return true;
    }
    return false;
  }

  function hideGuideExplore() {
    for (const sec of document.querySelectorAll("ytd-guide-section-renderer")) {
      sec.classList.toggle("ytc-hidden", isExploreSection(sec));
    }
  }

  // ---------- 關閉自動播放 ----------
  let lastAutoplayClick = 0;
  function disableAutoplay() {
    const btn = document.querySelector('.ytp-autonav-toggle-button[aria-checked="true"]');
    if (!btn) return;
    const now = Date.now();
    if (now - lastAutoplayClick < 2000) return; // 避免狀態還沒更新就連點兩次又打開
    lastAutoplayClick = now;
    (btn.closest("button") || btn).click();
  }

  // ---------- 播放頁：留言卡在上一支影片時自動修正 ----------
  // 換影片後，YouTube 偶爾沒有重新抓留言，留言區還是上一支影片的。
  // 每則留言的時間連結都帶著所屬影片的 ID（?v=…&lc=…），用它判斷留言是不是這支影片的：
  // - 全部屬於別支影片：先藏起來（換影片的那一瞬間也會這樣，藏起來剛好不會看到舊留言）
  // - 連續 3 秒都還是這樣：自動重新整理頁面，影片從目前的秒數接著播
  // 同一支影片 1 分鐘內最多自動重新整理一次，避免一直重新整理。
  // 有時舊留言身上的影片 ID 會被換成新影片的，只有文字還是舊的，所以也比對留言文字：
  // 每次確認留言正確時記下前 5 則的文字；換到別支影片後，顯示的留言和上一支記下的
  // 重複（至少 2 則；只有 1 則留言時就比那 1 則），也當成卡住。
  const STALE_RELOAD_KEY = "ytc-stale-comments-reload";
  let staleSince = 0;
  let lastComments = null; // { vid, texts }：上一次確認正確的留言
  function checkStaleComments() {
    const vid = new URLSearchParams(location.search).get("v");
    const comments = document.querySelector("ytd-comments#comments");
    if (!vid || !comments) return;
    const ids = new Set();
    for (const a of comments.querySelectorAll('ytd-comment-thread-renderer a[href*="lc="]')) {
      try {
        const v = new URL(a.href, location.href).searchParams.get("v");
        if (v) ids.add(v);
      } catch {}
    }
    const texts = [...comments.querySelectorAll("ytd-comment-thread-renderer #content-text")]
      .slice(0, 5)
      .map((e) => e.textContent.trim())
      .filter(Boolean);
    let textStale = false;
    if (lastComments && lastComments.vid !== vid && texts.length) {
      const repeated = texts.filter((t) => lastComments.texts.includes(t)).length;
      textStale = repeated >= Math.min(2, texts.length);
    }
    const stale = (ids.size > 0 && !ids.has(vid)) || textStale;
    comments.classList.toggle("ytc-stale-comments", stale);
    if (!stale) {
      staleSince = 0;
      if (texts.length) lastComments = { vid, texts };
      return;
    }
    if (!staleSince) staleSince = Date.now();
    if (Date.now() - staleSince < 3000) return;
    try {
      const last = JSON.parse(sessionStorage.getItem(STALE_RELOAD_KEY) || "null");
      if (last && last.vid === vid && Date.now() - last.at < 60000) return;
      sessionStorage.setItem(STALE_RELOAD_KEY, JSON.stringify({ vid, at: Date.now() }));
    } catch {}
    const video = document.querySelector("video");
    const url = new URL(location.href);
    if (video && video.currentTime > 1) url.searchParams.set("t", Math.floor(video.currentTime) + "s");
    redirecting = true;
    location.replace(url.href);
  }

  // ---------- 訂閱內容：分頁，每頁 15 支影片 ----------
  // 訂閱內容的影片都排在同一個格狀清單裡，YouTube 不會移除捲過去的影片，
  // 所以直接依清單順序分頁：不在這一頁的影片用 display: none 藏起來。
  // 這一頁滿 15 支後，藏起清單最後的「載入更多」，YouTube 就不會再往下載入，
  // 頁面自然停在分頁按鈕。分組標題（「最新」）和「最相關」區塊只在第 1 頁顯示。
  // Shorts 已被 style.css 藏起來，不算在內。從影片頁返回時留在原本的頁數，重新整理回到第 1 頁。
  const SUBS_PAGE_SIZE = 15;
  let subsPage = 0;

  // 點「訂閱內容」連結（側邊欄等）：回到第 1 頁。瀏覽器的上一頁不經過這裡，會留在原本的頁數。
  window.addEventListener(
    "click",
    (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.closest("#ytc-pager")) return;
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      if (url.hostname !== location.hostname || url.pathname !== "/feed/subscriptions") return;
      subsPage = 0;
      // 已經在訂閱內容頁時 YouTube 不一定會換頁，直接重新分頁、捲回頂端
      if (location.pathname === "/feed/subscriptions") {
        paginateSubscriptions();
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    },
    true
  );

  function isShortsItem(item) {
    return !!item.querySelector('a[href^="/shorts/"]');
  }

  function paginateSubscriptions() {
    const browse = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    const contents = browse && browse.querySelector("ytd-rich-grid-renderer > #contents");
    if (!contents) return;
    const start = subsPage * SUBS_PAGE_SIZE;
    const end = start + SUBS_PAGE_SIZE;
    let rank = 0;
    for (const el of contents.children) {
      const tag = el.tagName;
      if (tag === "YTD-RICH-ITEM-RENDERER") {
        if (isShortsItem(el)) continue;
        el.classList.toggle("ytc-off-page", rank < start || rank >= end);
        rank++;
      } else if (tag === "YTD-RICH-SECTION-RENDERER") {
        el.classList.toggle("ytc-off-page", subsPage > 0);
      }
    }
    const pageFull = rank >= end;
    // 這一頁滿了就藏起「載入更多」，還沒滿就讓它出現、繼續載入
    const more = contents.querySelector(":scope > ytd-continuation-item-renderer");
    if (more) more.classList.toggle("ytc-off-page", pageFull);

    let pager = browse.querySelector("#ytc-pager");
    if (!pager) {
      pager = document.createElement("nav");
      pager.id = "ytc-pager";
      pager.innerHTML =
        '<button type="button" data-go="-1">← 上一頁</button>' +
        "<span></span>" +
        '<button type="button" data-go="1">下一頁 →</button>';
      pager.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-go]");
        if (!btn || btn.disabled) return;
        subsPage = Math.max(0, subsPage + Number(btn.dataset.go));
        paginateSubscriptions();
        window.scrollTo({ top: 0, behavior: "instant" });
      });
    }
    if (contents.nextElementSibling !== pager) contents.after(pager);
    const lastPage = !more && rank <= end; // 沒有「載入更多」了：訂閱內容已經到底
    pager.hidden = !pageFull && !lastPage; // 這一頁還在載入時先不顯示
    const [prev, label, next] = pager.children;
    prev.disabled = subsPage === 0;
    label.textContent = "第 " + (subsPage + 1) + " 頁";
    next.disabled = !pageFull || lastPage;
    next.textContent = lastPage ? "沒有更多影片了" : "下一頁 →";
  }

  // ---------- 主檢查 ----------
  let redirecting = false;
  function check() {
    if (redirecting) return;
    const p = location.pathname;
    const t = redirectTarget(p);
    if (t) {
      redirecting = true;
      location.replace(t);
      return;
    }
    hideGuideExplore();
    const root = document.documentElement;
    root.classList.toggle(
      "ytc-playlist",
      p === "/watch" && new URLSearchParams(location.search).has("list")
    );
    if (p === "/watch") {
      disableAutoplay();
      refitPlayer();
      checkStaleComments();
    } else {
      staleSince = 0;
    }
    if (p === "/feed/subscriptions") paginateSubscriptions();
  }

  // ---------- 版面改變後，讓播放器重新計算大小 ----------
  let lastFitHref = "";
  function refitPlayer() {
    if (location.href === lastFitHref) return;
    lastFitHref = location.href;
    // 頁面元素是陸續載入的，分幾次觸發
    for (const ms of [0, 300, 1000, 2500]) {
      setTimeout(() => window.dispatchEvent(new Event("resize")), ms);
    }
  }

  let pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      check();
    });
  }

  check();
  setInterval(check, 250);
  window.addEventListener("popstate", check);
  window.addEventListener("yt-navigate-finish", check);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
