# YK LearnHub — Yuvraj's private learning platform

## Face ID lock
The app opens on a white lock screen with a black circle — the camera looks for YOUR face
(recognition runs 100% locally via face-api.js; nothing is sent anywhere).
- First launch: click "Set up Face ID" and look at the circle **with your spectacles on** (captures 5 samples).
- Every launch after: it recognizes you, the ring turns green with a tick, then the app opens.
- Successful logins are recorded in a randomly-named folder under `data\` (see Admin > Face ID & login sessions).
- Reset: Admin > "Reset Face ID", or if locked out delete `E:\LearnHub\data\face.json` and reload.
- Note: this is a motivational/personal lock, not bank-grade security.

## Desktop shortcut
**"YK LearnHub"** on your Desktop starts the server silently (if not already running)
and opens the app in its own window (Edge app mode). Launcher: `LearnHub.vbs`.

White theme, YK branding, playlists → videos, watch tracking, and music that plays
when you pause or leave the tab.

## Start it
Double-click **START.bat** (or run `node server.js` here). Opens at http://localhost:4321

## Add videos (two ways)
1. **⚙️ Admin tab** → create a playlist → "Choose video files" → upload anything,
   even multi-GB files (streamed straight to disk with a progress bar).
2. Or just copy files into `E:\LearnHub\videos\<playlist-folder>\` and refresh.

Name files `01 Intro.mp4`, `02 Numpy.mp4` … so they stay in order.
Supported: mp4, mkv, webm, mov, m4v, avi. Thumbnails auto-generate on first open.

## The music twist 🎵 (loud!)
- **Pause the video** → music plays until you hit play again
- **Switch tab / click away from the window** → "come back!" music until you return

Drop your own tracks in (first audio file in each folder is used):
- `E:\LearnHub\music\pause\`        → pause music (mp3/m4a/ogg/wav)
- `E:\LearnHub\music\distraction\`  → leave-tab music

Until you add files, a built-in loud synth melody plays as fallback.

## What's tracked (saved in E:\LearnHub\data\)
- Resume position + % watched per video (✓ DONE at 90%)
- Per-playlist and overall completion
- Watch time per day + daily streak 🔥
- Your posted updates

## Test files
`01/02/03 Test Video *.mp4` in the ML playlist are dummy clips I generated to test —
delete them and add your real recordings.
