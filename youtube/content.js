(function () {
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
    }
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
