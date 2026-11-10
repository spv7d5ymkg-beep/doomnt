# Doomn't

English | [繁體中文](README.md)

A Chrome extension that stops endless scrolling on YouTube and Instagram, and blocks adult boards on 4chan. It hides short videos and algorithm-driven feeds, leaving only what you choose to watch.

## YouTube

- No Shorts anywhere (sidebar, home, search results, subscriptions, channel tabs); `/shorts/` links open in the regular player instead
- The home page recommendations are gone, leaving just the search bar and your subscriptions
- Subscriptions are split into pages of 15 videos with "← Previous / Next →" buttons instead of endless scrolling
- Text-only lists across the site: subscriptions, search results, channel pages, playlists, Watch Later, history, the You page and the playlist panel on the watch page drop thumbnails and playlist covers, one video per row (title; channel • views • upload time • length)
- Subscriptions drop the "Most relevant" shelf; a red line separates today's uploads from earlier ones, labeled "EARLIER"
- Avatars and channel banners still show; video rows get the channel's small avatar before its name. Blocks that feature other channels (featured channels, channels in search results) are one per row like videos, with the subscribe button next to the name
- The top of a channel page (banner, channel info, tab bar) scrolls away with the page instead of collapsing in layers or overlapping the content below; hovering a video doesn't autoplay a preview
- Removes recommended videos next to the player, end-screen suggestions and autoplay; turns off ambient mode (the glow around videos in dark mode)
- Removes unrelated recommendation shelves from search results, and the Explore section from the sidebar

## Instagram

- The home page shows only stories by default; the "Stories / Posts" toggle above the stories switches to posts from accounts you follow
- Posts mode is a three-column grid like the Explore page, 12 posts per page with "← Previous / Next →" buttons instead of endless scrolling; hovering a tile shows the account, likes and comments, and clicking opens the full post in Instagram's own dialog
- Posts from before today are dimmed (back to normal on hover), so you can tell at a glance which ones are new
- Hides Reels; a single Reel opens as a regular post page, so you can't keep swiping
- The Explore grid is cleared, leaving just the search
- Suggested accounts on the right of the homepage (and your account above them) are hidden by default and the rest is centered; turn this off from the Doomn't toolbar icon
- Removes ads, suggested posts, and "More posts from …" under a post

## 4chan

- Hides all adult boards on the home page, plus every board under Misc except /pol/; the board list at the top of each page too
- Opening or clicking a link to these boards sends you back to the 4chan home page
- Popular threads on the home page always show SFW content only, with the toggle removed
- Click the Doomn't icon in the toolbar to turn the 4chan filter on or off (on by default)

## Language

- The interface is available in English and Traditional Chinese: click the Doomn't icon in the toolbar and pick one from the "Language" menu; open tabs switch right away
- Until you pick one, it follows Chrome's language: Chinese if Chrome is set to Chinese, English otherwise

## Install

No coding needed, takes about 2 minutes.

1. **Download**: click the green **Code** button at the top of this page, then **Download ZIP**.
2. **Unzip**: open the ZIP to get a folder (e.g. `doomnt-main`). Put it somewhere it won't get deleted, like your Documents folder. The folder has to stay there after installing.
3. **Open the extensions page**: type `chrome://extensions` in Chrome's address bar and press Enter.
4. **Turn on Developer mode**: flip the "**Developer mode**" switch in the top-right corner.
5. **Load the extension**: click "**Load unpacked**" in the top-left, pick the folder from step 2 (the one with `manifest.json` inside), and click "Select".
6. **Done**: once Doomn't shows up in the list, it's installed. Open or reload YouTube or Instagram to see it work.

Tips:

- To keep the icon in the toolbar, click the puzzle-piece icon to the right of the address bar, then the pin next to Doomn't.
- Chrome sometimes asks you to "disable developer mode extensions"; click "Keep" or just close it.
- Edge, Brave and other Chromium-based browsers install the same way (Edge's address is `edge://extensions`).

## Update to a new version

1. Download the new version as in steps 1–2 of "Install" and replace the folder's contents with the new files.
2. Open `chrome://extensions` and click reload (↻) on Doomn't.
3. Reload your YouTube and Instagram tabs.

## Uninstall

Open `chrome://extensions`, click "Remove" on Doomn't, then you can delete the folder.
