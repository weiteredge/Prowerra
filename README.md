# Prowerra (Interview Overlay) – Setup & Usage Guide

This Electron app provides an always-on-top interview assistant overlay that can transcribe audio in real time and generate concise answers or code with Gemini. It’s optimized for Windows.

## Features
- Live audio transcription via AssemblyAI Realtime
- Parallel LLM answers via Gemini (Interview and QA modes)
- Tabs UI: Setup, Live, Code, History
- Safeguards to prevent voice updates from overwriting manual input
- Code-tab persistence (non‑code replies won’t clear or switch away from Code)
- Download conversation history to a .txt file
- VB-CABLE guidance to route audio cleanly

## Requirements
- Windows 10/11
- Node.js 18+ (recommended)
- AssemblyAI API Key
- Google Gemini API Key

## Install
```bash
# From repo root
cd app
npm install
# If native modules are present
npm run postinstall
```

## Run (Development)
```bash
npm start
```
This launches the overlay.

## Build (Installer)
```bash
npm run dist
```
Output is produced by electron-builder per `package.json` build config.

## Configure & Start
1. Open the overlay and go to the `Setup` tab.
2. Enter:
   - `AssemblyAI API Key`
   - `Gemini API Key`
   - Choose `Gemini Model` (default: `gemini-2.5-flash`).
3. Click `Start`.
   - The status chip should show `Connected`.
   - The `Live` tab shows captions and AI responses.
4. Click `Stop` to end transcription.

## Audio Routing (VB-CABLE)
The app expects a Windows input device named:
- `CABLE Output (VB-Audio Virtual Cable)`

If you don’t have VB-CABLE set up:
1. Download from https://vb-audio.com/Cable/ and install (reboot required).
2. In Windows Sound settings, configure as follows (typical setup):
   - Playback: set `CABLE Input (VB-Audio Virtual Cable)` as Default device.
   - Recording: set your physical mic as Default.
   - Recording > Microphone (click) > Properties > Listen: Uncheck "Listen to this device" and set playback to `CABLE Input`.
   - Recording > CABLE Output (click) > Properties > Listen: Check "Listen to this device" and set `Playback through this device` to your speakers/headphones (e.g., Speaker/HP (Realtek High Definition Audio)).
3. Relaunch the app and press `Start` again.

If you want to use another device, update the `deviceName` passed in `src/renderer/renderer.js` where `start-transcription` is invoked.

## Using the Tabs
- `Setup`
  - Manage API keys and start/stop. The app won’t auto-switch away from Setup when AI updates arrive.
- `Live`
  - Shows the latest caption (what was heard) and the AI’s textual response.
- `Code`
  - Shows code when the request clearly has coding intent (e.g., “write a python program …”).
  - Non‑code replies do not clear this area or force a tab change.
- `History`
  - Shows a rolling conversation log and allows downloading a `.txt` transcript.

## Manual Ask (Bottom Input)
- After pressing `Start`, type a question and click `Ask`.
- While a manual Ask is in progress, live updates won’t overwrite it.
- If your question implies code, the Code tab will populate and remain until replaced by new code.

## Behavior Safeguards
- Live voice updates are paused only briefly while you type (short window) and while a manual Ask is running, to prevent overwriting typed input.
- Code is only updated when the intent is clearly code (or you explicitly asked for code).

## Screen Sharing Notes
- Screen-sharing tools capture pixels the OS draws. If the overlay is excluded by OS/window flags, it may not appear in capture.
- In `src/main/overlay.js`, content protection and display affinity can hide the overlay from screen sharing. If you want the overlay to be visible in a share, consider disabling those features.

## Troubleshooting
- "Status: disconnected" after Start
  - Check your AssemblyAI API key.
  - Firewall/Proxy rules may block `wss://api.assemblyai.com` or `wss://streaming.assemblyai.com` (depending on your configured version).
- No captions, no errors
  - Verify the audio device name. The default is `CABLE Output (VB-Audio Virtual Cable)`.
  - Confirm VB-CABLE is installed and routing is configured.
- LLM errors in Status
  - Check your Gemini API key and network connectivity.
- Code not appearing, but answers do
  - Ask explicitly for code (e.g., “write a JS function …”); the app detects code intent.
- History not updating
  - Ensure the app shows `Connected` and that you’ve granted keys and pressed `Start`.

## Project Structure (partial)
```
app/
  package.json
  src/
    main/
      main.js
      overlay.js
      transcription.js
    renderer/
      pages/
        overlay.html
      styles/
        style.css
      renderer.js
```

## Scripts
- `npm start`: Run in dev (Electron)
- `npm run dist`: Build installer (electron-builder)
- `npm run postinstall`: `electron-builder install-app-deps`

## Notes
- This app is Windows-focused (DirectShow `dshow` capture).
- If you change device names or routing, modify `deviceName` in the renderer start call to match your system.
- If you need help tailoring screen share visibility of the overlay, see `src/main/overlay.js` flags.
