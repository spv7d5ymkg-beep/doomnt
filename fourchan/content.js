(function () {
  // ---------- 要擋的看板 ----------
  // Adult 全部；Misc 只留 /pol/
  const ADULT = ["s", "hc", "hm", "h", "e", "u", "d", "y", "t", "hr", "gif", "aco", "r"];
  const MISC = ["b", "r9k", "bant", "soc", "s4s"];
  const BLOCKED = new Set([...ADULT, ...MISC]);
  const HOME = "https://4chan.org/";

  const root = document.documentElement;

  // 看板網址：boards.4chan.org/<看板>/…（舊網域 4channel.org 也一樣）
  function blockedBoard(url) {
    if (!/^boards\.4chan(nel)?\.org$/.test(url.hostname)) return false;
    return BLOCKED.has(url.pathname.split("/")[1]);
  }

  function boardOfLink(a) {
    try {
      const url = new URL(a.getAttribute("href"), location.href);
      return blockedBoard(url);
    } catch {
      return false;
    }
  }

  // ---------- 首頁：藏起 Adult 和 Misc（/pol/ 除外）、熱門討論串只看 SFW ----------
  function cleanHome() {
    // 首頁的看板分類：<h3>分類名</h3><h3>(NSFW)</h3><ul>看板…</ul>，Misc 和 Adult 跟其他分類擠在同一欄
    for (const ul of document.querySelectorAll("#boards .column > ul")) {
      // 只算有網址的連結（Adult 最後有一個空的 <a>）
      const links = [...ul.querySelectorAll("a[href]")].filter((a) => a.getAttribute("href"));
      const blocked = links.filter(boardOfLink);
      for (const a of blocked) a.closest("li").classList.add("doomnt-hide");
      // 整個分類都藏了：分類標題也藏起來；只剩 /pol/ 的 Misc 保留標題
      if (blocked.length && blocked.length === links.length) {
        let h = ul.previousElementSibling;
        while (h && h.tagName === "H3") {
          h.classList.add("doomnt-hide");
          h = h.previousElementSibling;
        }
      }
    }
  }

  // 熱門討論串的內容由 cookie「fpc」決定（ws = 只看 SFW），伺服器照它產生頁面，
  // 所以不是 ws 時改掉 cookie 再重新載入一次
  function forceWorksafePopular() {
    if (location.hostname !== "4chan.org" && location.hostname !== "www.4chan.org") return false;
    if (location.pathname !== "/") return false;
    if (/(?:^|;\s*)fpc=ws(?:;|$)/.test(document.cookie)) return false;
    document.cookie = "fpc=ws; domain=.4chan.org; path=/; max-age=31536000; secure";
    // cookie 沒寫進去的話不要一直重新載入
    try {
      if (sessionStorage.getItem("doomnt-fpc-reload")) return false;
      sessionStorage.setItem("doomnt-fpc-reload", "1");
    } catch {
      return false;
    }
    location.reload();
    return true;
  }

  // 每個頁面上方的看板列也拿掉擋掉的看板
  function cleanBoardLinks() {
    for (const a of document.querySelectorAll(".boardList a, #boardNavDesktop a, #boardNavMobile option")) {
      if (a.tagName === "OPTION") {
        if (BLOCKED.has(a.value)) a.remove();
      } else if (boardOfLink(a)) {
        a.classList.add("doomnt-hide");
      }
    }
  }

  function run() {
    if (blockedBoard(location)) {
      location.replace(HOME);
      return;
    }
    if (forceWorksafePopular()) return;
    root.classList.add("doomnt-4chan");
    const clean = () => {
      cleanHome();
      cleanBoardLinks();
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", clean);
    else clean();
  }

  // 點到被擋的看板連結：直接回首頁，不先載入看板
  document.addEventListener(
    "click",
    (e) => {
      if (!root.classList.contains("doomnt-4chan")) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || !boardOfLink(a)) return;
      e.preventDefault();
      e.stopPropagation();
      location.href = HOME;
    },
    true
  );

  // 工具列小視窗的開關（預設開啟）
  chrome.storage.local.get({ fourchan: true }, ({ fourchan }) => {
    if (fourchan) run();
  });
  chrome.storage.onChanged.addListener((changes) => {
    if (!changes.fourchan) return;
    if (changes.fourchan.newValue) run();
    else root.classList.remove("doomnt-4chan");
  });
})();
