# "Watch in Virowatch" deep links — setup

The Discord bot now shows **▶ Watch in Virowatch** buttons. Tapping one opens
Virowatch (the app if installed, else the browser) and auto-plays the title.
Three things must be deployed for it to work end to end.

Deep-link URLs the bot builds:
- Movie: `https://virowatch.ddns.net/?play=VDM_<tmdbId>`
- TV: `https://virowatch.ddns.net/?play=VDT_<tmdbId>&sk=S<season>&ep=<episode>`
- Anime: `https://virowatch.ddns.net/?anilist=<aniListId>&ep=<n>`

## 1. Site: the deep-link handler (required)

`deeplink.js` (new file) reads those params and calls the site's existing
`viroResume()` / `anikotoFindByAniList()`.

- Add it to your site's HTML, **after** content.js / vidnest-loader.js /
  anikoto-loader.js:
  ```html
  <script src="deeplink.js" defer></script>
  ```
- Commit `deeplink.js` + that `<script>` line to the **Saperan/Virowatch** repo
  and push. GitHub Pages redeploys; `virowatch.ddns.net` picks it up. No APK
  rebuild needed for this part — the app loads the live site.

Test in a browser first (no app needed):
`https://virowatch.ddns.net/?play=VDM_550` should open and start Fight Club.

## 2. Site: assetlinks.json (required for app-open)

`/.well-known/assetlinks.json` (new file) authorizes the app to handle the
domain's links. It already contains the app's package + signing fingerprint.

- Commit `.well-known/assetlinks.json` to the repo and push.
- Verify it's live and served as JSON:
  `https://virowatch.ddns.net/.well-known/assetlinks.json`
  (must return the file, `Content-Type: application/json`, over HTTPS.)

## 3. App: rebuild the APK (required for app-open)

`AndroidManifest.xml` and `MainActivity.java` were updated to register the
domain as an App Link and load incoming deep links.

```sh
cd apk
SDK=/c/Users/pc/.vw-android-sdk bash build.sh
```

Install the new `apk/Virowatch.apk` on the phone (over the top of the old one —
same signing key, so it upgrades in place). After install, Android verifies the
App Link against assetlinks.json within a minute or so.

Confirm verification (optional):
```sh
adb shell pm get-app-links net.virowatch.app
```
`virowatch.ddns.net` should show `verified`.

## Notes

- **Order matters:** deploy the site (1 & 2) *before* rebuilding the app, so the
  app's verification finds assetlinks.json already live.
- **Discord's in-app browser:** on some phones Discord opens links in its own
  in-app browser, which can bypass App Links (opens the site instead of the
  app). If so, in Discord: Settings → Advanced → "Open links in your browser"
  (external), or long-press the button → open externally. The site still
  auto-plays either way; only the app-vs-browser choice is affected.
- **Anime lookup** may take a few seconds the first time per device while the
  Anikoto catalog index builds (cached ~24h after that).
