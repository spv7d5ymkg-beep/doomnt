# YouTube 網頁版運作方式（Doomn't 開發筆記）

改 `youtube/content.js`、`youtube/style.css` 之前先讀這份。內容是在真實網站上量出來的（2026-11）。

## 1. 換頁

- 單頁應用程式。每種頁面是 `ytd-page-manager` 底下的一個元件（`ytd-browse`、`ytd-search`、`ytd-watch-flexy`…），
  換頁時舊的加上 `hidden`、不會移除，之後回來會重用。所以查詢要限定在 `ytd-page-manager > :not([hidden])` 裡。
- `ytd-browse[page-subtype]`：`home`、`subscriptions`、`channels`、`history`…
- 換頁事件：`yt-navigate-finish`（另外仍用 250ms 輪詢和 MutationObserver 補漏）。
- 頁面不允許 `eval`（Trusted Types），測試腳本不能用字串組程式。

## 2. 播放頁

- **整頁載入時先出現簡化版面** `#player.skeleton.flexy > #player-wrap > #player-api > #movie_player`，
  影片已經在裡面播放；幾秒後 `ytd-watch-flexy` 才建立，播放器被搬進去。兩者尺寸不同就會跳一下
  → 簡化版面要和正式版面用同一套尺寸。簡化版面沒有捲軸（寬度差 12px）→ `scrollbar-gutter: stable`。
- 影片畫面（`video.html5-main-video`）的寬高、位置是 YouTube 用 JS 寫在 style 上的，版面變了常慢 1～2 秒才重算。
  `.html5-video-container` 本身高度是 0。→ 用 CSS 讓容器和影片都填滿播放器，比例交給 `object-fit: contain`。
- `ytd-watch-flexy` 的屬性決定版面：`is-two-columns_`（寬度 ≥ 約 1000px）、`theater`、`fullscreen`、
  `live-chat-present-and-expanded`（直播；舊名 `live-chat-present`）。屬性名稱會改，改了規則就失效。
- 直播是否有聊天室要等正式版面載入後才知道（簡化版面階段分不出來）。
- 迷你播放器：`#movie_player` 被搬到右下角（400×225），同一個元素。

## 3. 清單

- 新版影片項目是 `yt-lockup-view-model`（class 都是 `ytXxxViewModel…`），舊版是 `ytd-video-renderer`（搜尋）、
  `ytd-playlist-video-renderer`、`ytd-grid-video-renderer`。兩種要同時支援。
- 頭像 `.ytLockupMetadataViewModelAvatar` 預設 `display: none`，藏著時圖片不會載入。
- 搜尋結果（2026-11 起）也改成 `yt-lockup-view-model`，直接放在 `ytd-item-section-renderer #contents` 底下，
  文字列的順序和訂閱內容不同：①頻道（`yt-avatar-stack-view-model`，自帶頭像）・觀看次數・時間 ②空白
  ③影片說明 ④章節／AI 摘要框（`lockup-attachments-view-model > yt-expandable-metadata-view-model`，有展開按鈕）
  ⑤「4K」「字幕」標籤。所以「最後一列」不是觀看次數那列（要找有分隔符號的列），
  「第一個文字欄位」也不是頻道名稱。字級寫在各文字欄位上，整列本身是 10px。
  Shorts 區塊是 `grid-shelf-view-model`（已經被藏）。
- 訂閱內容：`ytd-rich-grid-renderer > #contents` 底下是 `ytd-rich-item-renderer`（影片）、
  `ytd-rich-section-renderer`（區塊）、`ytd-continuation-item-renderer`（載入更多；藏起來就不會再載入）。
- 觀看紀錄一頁可能有 150～200 支影片：每次檢查都會掃過全部，任何「每支影片寫一次」的動作都很貴。

## 4. 頂端列

- `#masthead-container` 是 fixed（z-index 2020）；`ytd-masthead #background` 原本是半透明加 `backdrop-filter: blur`，
  捲得快時模糊跟不上。有些頁面另有 `#frosted-glass`。
- 顏色變數：深色模式下 `--yt-sys-color-baseline--base-background`（#0f0f0f）；`--yt-spec-base-background` 不存在。
  深色模式看 `html[dark]`。

## 5. 寫程式時的規則（踩過的坑）

- `check()` 每 250ms 和每次 DOM 變動都會跑。裡面**任何寫入都要先比較**：
  `classList.toggle`、`dataset.x = …`、`el.hidden = …`、`setAttribute` 就算值一樣也會產生屬性變動。
  曾經因為每次都寫 `data-ytc-duration`，觀看紀錄頁閒置時 4 秒內 9000 次變動、只剩 11fps。
- CSS 變數不存在時會用後備值：用之前先在頁面上確認它真的有值（深色模式曾因此變成白色頂端列）。
- `height: 100%` 需要上層有明確高度（曾因此讓影片高度變成 0）。
- 改播放器相關規則後要測：一般、劇院、迷你播放器、直式影片、播放清單、直播、整頁載入與站內點進來。
