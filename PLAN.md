# PLAN — Roadmap

> 🇻🇳 Vietnamese: [`PLAN.vi.md`](PLAN.vi.md)

## Architecture overview
```
┌──────────────────────────── Chrome (Manifest V3) ─────────────────────────────────────┐
│ content/  detector.js in every frame → service worker injects the main bundle into the  │
│           frame that has the playing video                                              │
│   sites + subsources : subtitle capture (YouTube player, Udemy API, textTracks, files, DOM) │
│   main.js            : 3 modes static / stream / live, rAF + timeupdate update loop     │
│   translator / phonetic : queues keyed by sentence text, prioritised around the playhead │
│   overlay / panel / lookup : 3-line subtitles, toolbar, transcript panel, lookup, wordbook │
│   dubber + voices    : dubbing, voice lock, self-calibrating rate, ducking               │
│ background/ service worker: translation (Chrome → Google → Azure/Claude), safe subtitle  │
│             fetching, dictionary, online TTS, shortcuts, remembers frames with video     │
│ offscreen/  (COOP/COEP isolated, 4 threads): Piper, MMS, Translator API, espeak phonetics │
│ popup/ options/ : quick settings, per-site switch, voices, wordbook, offline models       │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

## Done
### v0.1–v0.2
- Build-free MV3 skeleton; bilingual YouTube subtitles; Google translation with cache; Web Speech / Google TTS dubbing + ducking.
- Separate volume & font size; online voices Azure / Google Cloud (official APIs, user's key); generic adapter, **Udemy** (lecture API),
  **Coursera** (`<track>`); real-world testing with Claude in Chrome.
### v0.3
- Dropped every form of client spoofing: YouTube subtitles come from the player itself (page-bridge observes `/api/timedtext`).
- **Offline Piper voices** (onnxruntime-web + espeak-ng WASM) in the offscreen document; unified voice catalogue; new popup UI.
### v0.4
- **No mid-video voice changes**: voice locked per video; on error retry the same voice, switch permanently only after 3 consecutive failures (same gender).
- Rate smoothing (+0.12× / −0.06× per sentence), pitch decoupled from rate, Piper loudness normalisation, 0.7 s ducking delay.
- **Phonetics** (per-word IPA, US/UK English; pinyin; romanised Korean/Russian), **word lookup** (dictionary, real pronunciation, Vietnamese meanings).
- On-device translation via Chrome's Translator API (pack download from the popup); 20-minute circuit breaker when Google blocks.
- Runs in hidden tabs (`timeupdate` events), smarter sentence merging.
### v0.5
- Dubbing: sent straight to the offscreen document (bypassing the service worker); a voice not yet downloaded is **fetched in the background and waited for**
  (no substitute voice); **per-voice speaking-rate measurement** (Vais ≈ 19–20 chars/s) → rate mostly 1.0–1.2×; follows the video's playback rate;
  never skips a sentence that can still be read. Measured over 75 s: one voice, 0 errors, 0 skipped sentences.
- **Any page with a video**: lightweight detector in every frame, main bundle injected on demand (incl. cross-origin iframes, embedded YouTube);
  incrementally loaded textTracks (HLS/DASH), `.vtt/.srt/.ass/.ttml/.json` files the page loaded, **live mode** reading DOM subtitles;
  hides the site's subtitles even on unknown players (content matching); per-site on/off.
- **The video's own translation** (human-made target-language track) is preferred; timing drift detected automatically (cue scanning + audio anchors).
- **Learn while watching**: transcript panel (seek, search, auto-scroll), on-video toolbar, A/S/D/Q, auto-pause per sentence, draggable subtitles, wordbook + CSV export.
- **Offline male Vietnamese voice** (MMS, Meta; measured pitch 118 Hz) + number/symbol verbalisation; multithreaded offscreen (COOP/COEP) → Piper 2.2× faster, MMS 2.7×.
- YouTube: wait for ads to finish before enabling subtitles, no subtitles / dubbing during ads; shortcuts change settings directly in the service worker.
- Tested (headless Edge + CDP): YouTube, YouTube embedded in an iframe, Wikimedia Commons (video.js, 43 tracks, uses the existing Vietnamese track),
  test pages for DOM subtitles / .srt files / incrementally loaded tracks / cross-origin iframes; unit tests for the subtitle parsers and track-offset estimation.

### v0.7
- **Export for Video Catcher** (`content/export.js`): the companion download extension asks via `window.postMessage`
  (`YSN_EXPORT_PING/RUN/CANCEL`) → returns **ASS subtitles in the current style** (3 lines phonetics/original/translation, size, colour, background,
  font, position; PlayRes = current video size) + SRT, and the **whole-video dubbing** as 22.05 kHz WAV sent in 5-minute chunks
  (selected voice, rate stretched/smoothed as in dubber.js, no overlapping sentences; MMS/Google/fixed-rate voices time-stretched with pitch
  preserved via WSOLA) plus a **1 kHz original-volume envelope** (originalVolume/duckVolume, 0.12 s ramp in, 0.7 s hold, 0.35 s ramp out).
  System voices (Web Speech) can't be captured to a file → replaced by an on-device voice of the same gender; online voices can be disabled
  from the Video Catcher side. Read-only (never changes settings); accepts messages only from the same frame or its parent.

## Next
- [ ] Test on real Chrome (logged in): Coursera, Udemy Business (next-lecture navigation), TED videos on YouTube with drifting Vietnamese tracks,
      streaming sites using JW Player / ArtPlayer (needs a browser that decodes H.264 — headless Edge can't).
- [ ] Open the user's own subtitle file (.srt) for videos without subtitles (drag & drop onto the video).
- [ ] Hide the translation until hover (listening-practice mode), A–B loop.
- [ ] Glossary: user terms override the translation; multi-sentence context-aware translation with Claude.
- [ ] Videos without subtitles: speech recognition (Whisper on WebGPU in the browser, or a local helper).
- [ ] Release packaging: icon, privacy policy, GPL compliance (espeak-ng), MMS non-commercial license.

## Technical decisions
| Topic | Decision | Why |
|---|---|---|
| YouTube subtitles | Observe the player's own `/api/timedtext` responses (MAIN world), enable tracks through the player API | No client spoofing; self-made timedtext URLs need a `pot` token |
| Any site | 1 KB detector in every frame + `chrome.scripting` injects the main bundle on demand | Zero cost on pages without a video; works inside iframes |
| Source modes | static / stream (growing list) / live (DOM) | Covers incrementally loaded HLS and players that only paint subtitles |
| Translation, phonetics | Keyed by sentence text (Map) | Changing sentence lists never drift; repeated sentences translated once |
| Translation | Chrome Translator (offline) → Google → Azure; Claude optional | Unlimited with the on-device pack; circuit breaker when Google blocks, no request retries |
| Dubbing | Voice locked per video, rate calibrated on real audio, smoothed | Listeners never notice a "narrator change" |
| Offline voices | Piper (espeak-ng) + MMS (character-based) in the offscreen document, onnxruntime-web on 4 threads | Neural quality, nothing leaves the machine, fast enough to pre-render 2 sentences |
| Testing | Headless Edge + CDP (fresh profile each run, only this extension loaded) | Chrome ≥ 137 removed `--load-extension`; runs while the screen is locked |
| Storage | Settings in `storage.sync`; translation cache (150 videos) and wordbook in `storage.local`; frame state in `storage.session` | Settings sync across machines, large data stays local |

## Risks to watch
1. YouTube changes its subtitle loading / UI (`.ytp-caption-window-container`, `ad-showing` classes) → check periodically on a captioned YouTube video.
2. The free Google endpoint may block by IP → 20-minute circuit breaker + prompt to download the on-device translation pack.
3. Unknown players change CSS classes → live mode relies on a selector list + position/content matching; extend as new sites appear.
4. Licenses: espeak-ng GPL-3.0 (bundled), MMS CC BY-NC 4.0 (downloaded by the user) — must be resolved before commercial release.
