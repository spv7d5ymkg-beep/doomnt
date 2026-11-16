# 4chan 運作方式（Doomn't 開發筆記）

- 傳統多頁網站，每次點連結都是整頁載入，沒有站內路由。首頁 `4chan.org`，看板在 `boards.4chan.org/<看板>/`
  （舊網域 `4channel.org` 相同）。
- 首頁看板分類：`#boards .column > h3（分類名）[+ h3 (NSFW)] + ul > li > a`。
- 首頁「Popular Threads」（`#popular-threads`）的內容由伺服器依 cookie `fpc` 產生（`ws` = 只有 SFW），
  改 cookie 後要重新載入才生效。`#opts-btn` 是切換它的按鈕。
- 看板頁上下各有一條看板列：`#boardNavDesktop`、`#boardNavDesktopFoot`（`.boardList a`），
  手機版是 `#boardNavMobile` 的 `<select id="boardSelectMobile">`。
- 公告（`.blotter-content`）和貼文內文裡也可能有連到被擋看板的連結：不藏（藏了句子會斷），點了由點擊攔截導回首頁。
- 被擋的看板（含 `/catalog`、討論串）直接用網址進入時，`document_start` 就導回首頁。
