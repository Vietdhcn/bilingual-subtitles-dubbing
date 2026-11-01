# PRODUCT — Bilingual Subtitles & Dubbing (Chrome Extension)

> 🇻🇳 Vietnamese: [`PRODUCT.vi.md`](PRODUCT.vi.md)

## 1. Vision
Let Vietnamese viewers and language learners watch **any video on the web** — YouTube, Coursera/Udemy courses, lectures, films,
embedded players — with **bilingual subtitles**, **phonetics**, **word lookup** and **real-time voice dubbing**,
without downloading the video or leaving the page. Turn it on once and it just runs.

## 2. Problem
- Most videos only have original-language captions; the site's auto-translation shows **one language only**, so you can't read both side by side to learn.
- People who don't like reading subtitles (working while listening, older viewers) need **dubbing**; AI dubbing tools usually require uploading the video, waiting, and paying per minute.
- Learners need **pronunciation, word meanings and sentence replay** right on the video, without switching to a dictionary or another app.

## 3. Audience
| Persona | Core need |
|---|---|
| English / Chinese / Korean / Japanese learners | Original + phonetics + translation at the same time; click a word to look it up; replay and auto-pause per sentence; save words for review |
| Online-course students (Coursera, Udemy Business) | Understand lectures fast: bilingual subtitles + natural-sounding dubbing that never changes voice mid-video |
| Film / entertainment viewers | Vietnamese subtitles for films that don't have them; prefer human-made translations when available |
| "Listen-only" viewers | Dubbing that ducks the original audio and keeps running in background tabs |

## 4. Features (v0.5)
### 4.1 Subtitles
- Automatic subtitle capture: YouTube, Udemy, textTracks (incl. HLS/DASH), the page's subtitle files, or reading the subtitles the player paints into the DOM.
- Merge cues into sentences; translate into the target language (default Vietnamese); **prefer the video's existing translation**, auto-correcting timing drift.
- 3 independently toggled lines: phonetics · original · translation; font size, colour, background, font; drag to reposition; hide the site's own subtitles.
### 4.2 Learn while watching
- Word lookup (phonetics, pronunciation, meanings, examples), wordbook + CSV export.
- Full transcript panel (seek, search, auto-scroll); previous / repeat / next sentence; auto-pause after each sentence; A/S/D/Q keys; on-video toolbar.
### 4.3 Dubbing
- Offline female (Vais) and male (MMS) Vietnamese voices, system voices, Google, Azure / Google Cloud (user's key).
- Voice locked per video; self-calibrating, smoothly changing speaking rate; follows the video's playback rate; smooth ducking; skips ads.
### 4.4 Any site
- Detects the real playing video on any page/frame; per-site on/off; zero cost on pages without a video.

## 5. User flow
1. Install the extension → open any video.
2. Bilingual subtitles appear right away (popup: pick lines to show, target language, text style).
3. Turn on **Dubbing** → pick a voice (preview, one-time offline voice download) → the original audio ducks while speaking.
4. Learn: click a word to look it up and save it; open the **sentence panel**; use A/S/D/Q to drill sentence by sentence.
5. Switch video / site → the extension re-runs automatically; turn it off for a site at the bottom of the popup.

## 6. Out of scope (for now)
- Videos with no subtitles at all (needs speech recognition — see PLAN).
- Downloading the video / exporting a dubbed video.
- Non-Chromium browsers.

## 7. Success metrics
- First translated sentence appears **< 3 s** after playback starts (measured: YouTube ~2–5 s including subtitle download).
- Dubbing: **one single voice** for the whole video, rate usually **1.0–1.2×**, skipped sentences **< 5 %** (measured: 0/14).
- Sites with subtitles rendered bilingually **> 95 %**.

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Sites change their subtitle plumbing | Several fallback sources (tracks, files, live DOM); automated test tooling |
| Google rate-limits translation | Chrome on-device translation, circuit breaker, Azure / Claude |
| Lack of Vietnamese voices | Offline voices downloaded inside the extension (female / male), Google, online voices with a key |
| Component licenses | Documented in README / THIRD_PARTY_NOTICES; MMS is personal-use only |
