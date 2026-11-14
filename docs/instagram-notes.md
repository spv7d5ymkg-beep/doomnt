# Instagram 網頁版運作方式（Doomn't 開發筆記）

改 `instagram/content.js`、`instagram/style.css` 之前先讀這份。內容都是在真實網站上量出來的（2026-11），
Instagram 改版後可能失效；發現不一樣就更新這份文件。

## 1. 換頁（路由）

- Instagram 是單頁應用程式：站內換頁不重新載入，網址先變，舊的 `<main>` 會多留 0.3～1 秒，
  然後整個被**新的 `<main>` 元素**取代（不是重用）。標在舊 `<main>` 上的屬性會跟著消失。
- 自己觸發換頁：`history.pushState(null, "", path)` + `dispatchEvent(new PopStateEvent("popstate"))`。
  已確認可用：`/`、`/?variant=following`、`/p/ID/`、`/stories/帳號/`、`/explore/`、`/direct/inbox/`。
- **站內切換到 `/`（首頁）不可靠**：從 `/?variant=following` 用 pushState 回 `/`，Instagram 有時會顯示空的首頁
  （「Get fresh updates here when you follow accounts」+ 推薦帳號），沒有限時動態列也沒有貼文，而且同一份文件裡會一直這樣。
  所以「限時動態」按鈕用整頁載入；其他路徑回到首頁遇到這個狀態時由 `healEmptyHome()` 重新載入。
  切換到 `/?variant=following` 則每次都正常。
- **`/` → `/?variant=following` 時 `<main>` 是同一個元素**（不會換新的），舊的演算法動態會多留約 4 秒，
  期間往下捲還會繼續載入舊動態的貼文；之後裡面的動態容器才整個換成追蹤中動態。
  換的只有 `<article>` 本身，外層容器是沿用的（不能用容器分辨新舊）。
  切換時記下當下的貼文，其中還有任何一篇在頁面上就代表還沒換（`feedSwapping()`），這段期間不收也不捲。
- 換頁時 Instagram 會佔住主執行緒 0.3～1 秒（畫面凍結）。要讓使用者馬上看到反應，
  先改畫面，等瀏覽器畫完一格（`requestAnimationFrame` → `setTimeout 0`）再換網址。
- 換頁的資料來自 `/ajax/navigation/`，第一次 0.5～2 秒，同一頁第二次約 0.3 秒（有快取）。
- 整頁載入時，資料直接寫在 HTML 的 `<script type="application/json">` 裡
  （例如限時動態名單 `xdt_api__v1__feed__reels_tray.tray`）；站內換頁時沒有這些。
- `/stories/帳號/` 直接用網址載入會出現「以某某身分觀看？」；用 pushState 開則是單人播放器，看完自動關閉。
- `#splash-screen`：初始 HTML 裡的全螢幕載入畫面（z-index 100）。

- **分頁在背景時**（切到別的分頁）Chrome 暫停畫面更新、放慢計時器，Instagram 不會把捲到的內容畫出來。
  背景捲動讀到的資料是不完整的 → 掃描、載入都用 `whenVisible()` 等回到前景；等待上限的計時不算背景時間。

## 2. 首頁

- `<main>` 是直向 flex、`justify-content: center`（內容少會被推到中間）。
- 結構：`main > 列(flex) > [動態欄, 右側推薦欄]`；動態欄裡「限時動態列」和「貼文區塊」是兄弟。
- `?variant=following` = 追蹤中動態（照時間排）；沒有參數 = 演算法動態。
- 動態是虛擬清單：頁面上同時只有 3～8 個 `<article>`，其餘被移除、留空白佔位。
  往下捲才會載入下一批；每一批渲染會造成 100～280ms 的卡頓（Instagram 自己的成本，藏起來也一樣）。
  → 背景捲動越少越好（快取接上就停，見 `caughtUp`）。
- 限時動態列：橫向虛擬清單，頁面上只有畫面附近 11～17 個 `<li>`，靠 `scrollLeft` 換內容。
  剛載入時捲動區可能還沒有橫向溢出。外圈 `<canvas>` 彩色 = 沒看過、灰色 = 看過。
  被藏起來的元素 `innerText` 是空的，要用 `textContent`。

## 3. 貼文

- 貼文頁 `/p/ID/`：`main > div > [貼文卡片, 更多貼文…]`。卡片依比例有自己的 `max-width`，不要覆蓋。
  載入時卡片先是 32×32 的轉圈，之後才是完整內容。
- 「更多貼文」的資料和貼文一起回來，縮圖一建立就下載，擋不掉，只能藏。
- Instagram 的對話框（`[role="dialog"]`）：影片放在 4:5 的 padding-bottom 框裡。

## 4. 堆疊順序

- 很多外層區塊是 `z-index: 0`，會把裡面的 fixed 元素困住。要讓元素浮到我們的版面上，
  得把那些祖先改成 `z-index: auto`（`.igc-unstack`、`.igc-unstack-post`）。
- 我們的層級：格狀版面 1、載入動畫 3、訊息按鈕 5、貼文遮罩 19、貼文視窗 20、關閉鈕 21。

## 5. 左側選單

- 收合 72px，滑鼠移上去展開（用行內 style 做動畫）。「首頁」是清單裡的 `a[href="/"]`
  （最上面的標誌也是 `a[href="/"]`，但不在清單裡）。

## 6. 寫程式時的規則（踩過的坑）

- `classList.add/toggle` 就算沒變也會產生屬性變動紀錄 → 一律用 `setClass()`。
- `check()` 每 250ms 和每次 DOM 變動都會跑：裡面的每個動作都要「沒變就不動」，不然會自己觸發自己。
- 量「有沒有露出來」要用 `checkVisibility({visibilityProperty: true, opacityProperty: true})`。
- 不要假設元素會被重用，也不要假設會被換掉：每次都重新找，並檢查 `isConnected`。
- 文字比對要同時有中文和英文（介面語言會變）；能用結構、位置、aria-label 就不要用文字。
- 測試一定要在真的 Instagram 上做；不要打開沒看過的限時動態（會留下觀看紀錄）。
- 各種操作的正常時間（超過就是有問題）：切換限時動態／貼文 0.3～1 秒；打開貼文 0.4～2 秒（先出現載入動畫）；
  關閉貼文馬上；閒置時 60fps、沒有長任務。
