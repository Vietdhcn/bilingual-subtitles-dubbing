# Bilingual Subtitles & Dubbing — Chrome Extension

Watch videos on **YouTube, Udemy, Coursera, movie streaming sites and any page with a video** (lectures, films, embedded players) with
**bilingual subtitles**, **phonetic transcription**, **tap-to-look-up dictionary** and **real-time AI voice dubbing**.
No video download, no waiting for processing, no account required.

> 🇻🇳 Tài liệu tiếng Việt: [`README.vi.md`](README.vi.md) · Product overview: [`PRODUCT.md`](PRODUCT.md) · Roadmap & technical decisions: [`PLAN.md`](PLAN.md) (both in Vietnamese)

## Quick start (5 minutes)
1. Install the extension (see **Installation** below) and open a YouTube / Udemy / Coursera video.
2. Every tab starts **off**. In the tab you want: click the extension icon → turn on **Subtitles** (or hover the video → subtitle button at the top-right). The *Subtitles* card picks which lines to show: phonetics · original · translation.
3. If the *Subtitles* card shows **On-device translation → Download pack**, click it once. From then on translation runs offline and can't be rate-limited by Google.
4. Turn on **Dubbing** (per tab) → *Voice* card: press ▶ to preview, pick a voice (on-device neural voices, downloaded once).
   For expressive, human-like voices, add a key under **⚙ Advanced settings → Online voices** (see the voice table below).
5. While watching: hover the video for the toolbar; keys `A` `S` `D` `Q` to study sentence by sentence; click any word to look it up.

## Features (v0.7.0)
### One mode per tab — off by default
- A newly opened tab **does nothing** (no subtitles, no dubbing, original audio untouched). Enable it per tab: hover the video →
  **Subtitles** / **Dubbing** buttons at the top-right, or `Alt+Shift+S` / `Alt+Shift+D`, or the two big switches in the popup.
- An enabled tab stays enabled across page reloads, video / lesson changes in the same tab, and even extension updates.
  Closing the tab or restarting the browser resets it to off.
- Font size, colours, voice, languages… are shared across all tabs.

### Subtitles
- **3 independently toggled lines**: phonetics (US/UK English IPA, pinyin, romanised Korean/Russian) · original subtitle · translation.
  **Original and translated lines are styled separately**: in the popup choose **Style: Translation | Original** → each line gets its own
  font size, colour (5 presets + **Custom…**), background (outline / dim / solid) and font; the phonetic line follows the original line's style.
  **Drag the ⠿ handle** on the right of the subtitles to reposition them.
- **Re-segmentation into complete sentences** before translating and reading, regardless of how the source captions are cut:
  YouTube auto-captions chop sentences into 5–6 s chunks ("…But your" | "curiosity has been hijacked.") — they are re-joined into real
  sentences using per-word timing; overly long sentences are split at commas / conjunctions; mid-sentence [music] tags are dropped.
  Translations make sense and the dubbing reads whole sentences.
- **Smooth transitions**: short gaps between sentences keep the previous one on screen (no flicker); new sentences fade in over 0.14 s.
- **Seek into an untranslated part** → the sentence on screen is translated immediately (a dedicated "urgent" lane, ~0.6–1 s);
  the rest is translated in the background.
- **Dubbing without bilingual subtitles** → clean video, the site's own captions (YouTube CC, Udemy subtitles…) are hidden.
  Turn both off → the page is restored to its original state (including YouTube CC the extension switched on).
- **The video's own human translation is preferred**: if the video has a translated track made by people (TED, films…), it is used instead of
  machine translation; timing drift between the two tracks is detected and corrected, with a fallback to machine translation if they don't match.
- **Word lookup**: click a word in the subtitles → phonetics, pronunciation (real US/UK recordings when available, TTS, slow playback),
  meanings by part of speech, examples, synonyms; the video pauses automatically. **☆ Save** to the **Wordbook** (with the sentence
  as context) → browse / search / export CSV for Anki, Quizlet on the Advanced page.

### Learn while watching
- **Sentence panel**: the whole transcript, bilingual, docked on the right; the current sentence is highlighted and auto-scrolled;
  click to seek; search (accent-insensitive).
- **On-video toolbar** (on hover): subtitles, phonetics, previous / repeat / next sentence, auto-pause, sentence panel, dubbing.
- **Study keys**: `A` previous sentence · `S` repeat sentence · `D` next sentence · `Q` auto-pause after every sentence (listening / shadowing).

### Dubbing
- Reads the translated sentence at the right moment; **the voice is locked for the whole video** (no mid-video voice swaps);
  speaking rate is **measured per voice** and changed gradually (max +0.12× / −0.06× per sentence); follows the video's playback rate
  (1.25×, 1.5×…); compensates for latency and never skips a sentence that can still be read in time.
- Volumes are relative to the level you set on the player: dubbed voice, original audio, original audio while speaking
  (smooth ducking), or mute the original entirely.
- Silent during YouTube ads; keeps reading when you switch tabs or minimise Chrome
  (the original audio is "silenced" at 0.01 % instead of muted so Chrome doesn't pause the background video).
- If an online voice is blocked or out of quota → permanently switches to an on-device voice of the same gender (downloading it if needed)
  instead of going silent; other sporadic errors only trigger a switch after 3 consecutive failures.
- **Video already spoken in the target language** (e.g. a Vietnamese video with English subtitles, a Vietnamese Udemy course) → original audio
  is kept, no dubbing (spoken language detected from YouTube auto-captions / the Udemy course language). A video that only has
  target-language subtitles but is spoken in another language (a film with Vietnamese subs) is still read aloud.
- Opened a video in a new tab without clicking the page yet: Chrome blocks audio → a hint asks you to **click the video once**,
  then dubbing continues with **the voice you chose** (no voice change).

| Voice type | Vietnamese | Notes |
|---|---|---|
| Neural, offline (on-device) | **Vais** (female, Piper), **MMS** (male, Meta) | Nothing leaves your machine. One-time download (63 MB / 114 MB). Multithreaded, 3–10× faster than real time. Male/female voices also available for English, French, German, Russian, Chinese, Spanish, Portuguese. |
| System voices | An (male) on Windows; Edge has HoaiMy / NamMinh | Offline, free. |
| Google | 1 female voice | Online, free. |
| **Expressive, human-like** (needs a key) | **Gemini TTS**: 30 male/female voices, emotion controlled by a text prompt · **Google Cloud Chirp 3 HD**: 30 voices · **ElevenLabs** · **OpenAI** (13 voices) | Official APIs. Gemini key free at aistudio.google.com/apikey (free tier); Chirp 3 HD has a free quota; ElevenLabs has a small free tier; OpenAI is pay-per-use. The **Speaking style** box (Gemini, OpenAI) accepts prompts like "warm, engaging storyteller". |
| Online with key | Azure: HoaiMy (female), NamMinh (male), multilingual / HD voices | Official API, free F0 tier every month. |

### Translation
Order: **the video's own translated track** → **Chrome on-device translation** (Translator API, offline, unlimited) → Google Translate
→ Azure Translator (if you add a key). Or pick **Claude** (your key) for context-aware translation.
- Chrome only allows a page to use the on-device pack after **one user click**. When Google blocks you, the video shows an
  **"Enable on-device translation"** button — click it once per site (YouTube, Udemy, Coursera…). The popup also has a **Download pack** button.
- When Google blocks: translation rests for 20 min, the Google voice for 3 min (two separate circuit breakers).
Translations of the last 150 videos are cached; download bilingual `.srt`.

### Download video with subtitles / dubbing (with Video Catcher)
Install the **Video Catcher** extension (same author): its download menu gains a *Subtitles & dubbing* entry — the downloaded file has
burned-in subtitles in the style you're watching, or a toggleable track, and the dubbing pre-mixed (original ducked as while watching)
or as a second audio track. This extension only supplies the data (ASS/SRT subtitles, full-video narration) via `window.postMessage`;
downloading and muxing is done by Video Catcher.

### Any page with a video
| Site | Subtitle source |
|---|---|
| YouTube (incl. embeds on other sites) | The captions the YouTube player itself downloads (no client spoofing) |
| Udemy, Udemy Business | The site's lecture API, using your logged-in session |
| Coursera, edX, Vimeo, TED, video.js, Plyr, hls.js, Shaka… | `textTracks` of the `<video>` — including HLS/DASH cues loaded segment by segment |
| Players that render subtitles from a file | Auto-detects `.vtt .srt .ass .ttml .json` files the page has loaded |
| Players that only paint subtitles into the DOM (Netflix, JW Player, ArtPlayer…) | **Live mode**: reads the subtitle on screen, translates and reads it right away |

On unknown sites the main bundle is injected only into **the frame whose video is playing** (iframes included); pages without a video cost
nothing. Per-site on/off switch at the bottom of the popup; the auto-enable-everywhere behaviour can be turned off on the Advanced page.
Video without subtitles: turn on CC in the site's player and the extension picks it up.

### Keyboard shortcuts
`Alt+Shift+S` toggle subtitles · `Alt+Shift+D` toggle dubbing · `A` `S` `D` `Q` while watching (see above) · `Esc` close the lookup panel.

## Installation (developer mode)
1. Open Chrome (or Edge / Brave) → `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → pick the `extension/` folder.
3. Open a video → click the extension icon → turn on **Subtitles** (and **Dubbing** if you like).
4. After changing the code: click **↻ Reload** on the extension card. Since 0.5.3 the extension re-injects itself into open tabs
   (the old copy cleans itself up), no F5 needed. Only when upgrading from ≤ 0.5.2 do you need to F5 the video tabs once.

No build step — plain JS (Manifest V3).

## Paid edition on the Chrome Web Store
Same source; `edition.js` decides the edition. The `extension/` folder is the **personal edition** (`YSN_EDITION = 'dev'`, no limits,
all offline voices); `python3 tools/build-store.py` builds the **store edition** into `dist/store/` and
`dist/song-ngu-thuyet-minh-<version>.zip` (upload to the store). Differences in the store edition:
- **Free 30 minutes/day** with every feature (counted only while the video is playing and the tab has subtitles or dubbing on; several tabs
  playing at once aren't double-counted; a reminder at 5 minutes left; when exhausted the tab turns off and shows an upgrade prompt; resets at midnight).
- **Pro** ($2/month, $20/year, $50 lifetime) unlocked with a **Lemon Squeezy** license key: the extension calls the License API directly
  (`background/license.js`), no server of our own; only keys for the right store/product are accepted; re-validated every 12 h,
  Pro is kept for 7 days offline. **Pro** section on the Advanced page: pricing, enter key, re-check, deactivate this machine,
  manage-subscription link. The popup shows "Free · N min left" / "Pro".
- The store name doesn't use "YouTube"; the offline Piper/MMS voices are removed (training data forbids commercial use);
  ships with `LICENSE` (GPL-3.0) + `NOTICE.txt`.
- Store configuration (store ID, product/variant IDs, checkout links, support email, prices): `store/config.json`.
- Store submission kit: `store/listing.md`, `store/review-notes.md`, `store/privacy.html`, images in `store/assets/`;
  release steps: `store/HUONG-DAN-PHAT-HANH.md` (Vietnamese).

## Data sources & third-party licenses
- **YouTube**: `content/page-bridge.js` (MAIN world) only *observes* the `/api/timedtext` responses the player downloads and calls the player's own API to enable a track.
- **Piper voices**: models from the official `rhasspy/piper-voices` repo (Vais: CC BY 4.0). **MMS** (male voice): `facebook/mms-tts-vie`,
  Xenova's ONNX build, licensed **CC BY-NC 4.0 — personal, non-commercial use only**.
- Offline libraries in `extension/offscreen/vendor`: onnxruntime-web (MIT), piper-phonemize (MIT) which bundles **espeak-ng (GPL-3.0)**,
  pinyin-pro (MIT) — see `THIRD_PARTY_NOTICES.txt`. Public distribution must comply with GPL-3.0.
- Dictionary: Free Dictionary API (`dictionaryapi.dev`, Wiktionary data, CC BY-SA); pronunciation audio from Wikimedia.

## How it works
```
Frame with the video (content scripts)                    Service worker            Offscreen document (isolated, multithreaded)
──────────────────────────────────────                    ──────────────            ──────────────────────────────────────────
detector.js   every page: wait for a playing <video> ──INJECT_FULL──► inject main bundle into that frame
sites.js      YouTube / Udemy / generic adapter
subsources.js textTracks · subtitle files · live DOM
captions.js   sentence merging, align existing translation
translator.js translation queue keyed by sentence text ──TRANSLATE──► Chrome Translator ────► LOCAL_TRANSLATE
                                                          → Google → Azure / Claude
phonetic.js   phonetic line ─────────────────PHONETIC──────────────────────────────────► espeak-ng IPA, pinyin…
overlay.js    3 subtitle lines, toolbar, drag handle
panel.js      sentence panel, A/S/D/Q, auto-pause
lookup.js     dictionary + wordbook ─────────LOOKUP──────► dictionaryapi.dev + translation
dubber.js     dubbing, voice lock ───────────PIPER_SYNTH (direct) ───────────────────► Piper / MMS (onnxruntime-web)
main.js       orchestrates the 3 modes: static · stream · live
```
- Fully synced to `video.currentTime` (survives seeking, pausing, ads, playback-rate changes); hidden tabs keep running on `timeupdate` events.
- Translations / phonetics are cached by **sentence text**, so growing sentence lists (HLS, live mode) never drift.
- The Advanced page / offscreen document is cross-origin isolated (COOP/COEP in the manifest) → onnxruntime runs on 4 threads.

## Folder layout
```
extension/
├─ manifest.json
├─ dev-mode.json                  # {"devChannel": false} — only true when running the test tooling
├─ background/service-worker.js   # translation, per-frame injection, safe subtitle fetching, online TTS, dictionary
├─ background/cloud-tts.js        # online voices: Azure, Google Cloud, Gemini, OpenAI, ElevenLabs
├─ offscreen/                     # tts.js (Piper, on-device translation, phonetics), mms.js (MMS voice), phonetics.js, vendor/
├─ content/
│  ├─ detector.js                 # every page/frame: detect the real playing video
│  ├─ settings.js  captions.js  sites.js  subsources.js  translator.js  phonetic.js
│  ├─ overlay.js / overlay.css    # subtitles, toolbar, sentence panel, lookup panel
│  ├─ voices.js  dubber.js  lookup.js  panel.js  main.js
│  └─ page-bridge.js              # MAIN world on YouTube
├─ popup/                         # quick settings, preview, voices, per-site switch
├─ options/                       # sites, wordbook, translation, offline/online voices, storage
└─ icons/
tools/build-store.py              # package the store edition → dist/store/ + zip for upload
```

## Troubleshooting
| Symptom | Fix |
|---|---|
| No subtitles on a streaming site | Turn on subtitles (CC) in the site's player; the extension picks them up within seconds. Check the per-site switch at the bottom of the popup. |
| Translation line stays "…" for a long time | Google is temporarily blocking your network → click **Enable on-device translation** on the video (or **Download pack** in the popup); or add an Azure / Claude key on the Advanced page. |
| Dubbing goes silent when switching tabs / minimising Chrome | Usually no translation (Google blocked, see above) or the Google voice is blocked — since 0.5.4 an offline voice is downloaded and used instead (no bouncing between failing voices). See errors at `chrome://extensions` → the extension's **Errors** button. |
| Moving from a reading / quiz to a video lesson gives no subtitles or dubbing (Coursera, Udemy) | Race condition on lesson change, fixed in 0.5.5. |
| Video stays silent after turning dubbing off (with "Mute original" on) | Fixed in 0.5.5: turning dubbing off restores the original volume. |
| Vietnamese video gets muted and read over | Fixed in 0.5.5: videos spoken in the target language are not dubbed. |
| Vais (offline) voice goes silent, log shows "[espeak] Aborted" then "memory access out of bounds" | Fixed in 0.5.7: characters that break the phonemizer (emoji, control chars…) are stripped, batches are smaller, and the phonemizer is rebuilt if it still crashes — the next sentence reads normally. |
| After dragging a slider in the popup, nothing responds for about a minute | Fixed in 0.5.7: settings are stored locally (no write-rate limit) and synced to the account after 2 s. |
| Turning bilingual subtitles off shows the site's English captions | Fixed in 0.5.6: while dubbing is on, the site's captions stay hidden. To see the site's captions with dubbing, turn off **Hide the site's own subtitles** in the popup. |
| Dubbing silent on the first sentence | The offline voice is downloading for the first time (popup says "Downloading voice…"); it reads as soon as it's ready — no voice change. |
| No audio at all | Chrome blocks audio until you click the page once — the video shows a hint; click the video to continue. |
| Udemy / Coursera says there are no subtitles | Open the actual **lecture** page of a course you're enrolled in. |
| Just updated but behaviour is old | Reload the extension at `chrome://extensions`, then **F5** the video tab. |

## Permissions
- `storage`: settings, translation cache, wordbook · `offscreen`: run offline voices / on-device translation · `scripting` + `<all_urls>`:
  inject the main bundle into the frame with the video on any site and fetch the site's subtitle files.
- Text is only sent to the translation / voice services you choose (Google, Azure, Claude, Gemini, OpenAI, ElevenLabs…); offline voices and
  on-device translation send nothing anywhere.
- API keys are stored only in your Chrome (`chrome.storage.sync`) and sent directly to the respective provider.

## License
GPL-3.0 (`LICENSE`) — because the extension bundles espeak-ng (GPL-3.0). Third-party components: `store/NOTICE.txt`,
`extension/offscreen/vendor/THIRD_PARTY_NOTICES.txt`.
