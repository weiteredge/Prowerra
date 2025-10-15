// src/main/main.js
const { app, ipcMain, BrowserWindow, shell, dialog } = require("electron");
const { createOverlay } = require("./overlay");
const transcription = require("./transcription");
const { exec } = require('child_process');
const fs = require('fs');

let overlayWindow;

// Function to check if VB-CABLE is installed by querying Windows registry for devices
function isVBCableInstalled() {
  return new Promise((resolve) => {
    try {
      const cmd = 'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio" /f "VB-Audio Virtual Cable" /s';
      exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          // Fallback: also try searching for "CABLE Input"/"CABLE Output"
          const fallback = 'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\MMDevices\\Audio" /f "CABLE Input" /s';
          exec(fallback, { windowsHide: true }, (err2, out2) => {
            if (err2) return resolve(false);
            const hasCable = /CABLE Input|CABLE Output/i.test(out2 || '');
            resolve(!!hasCable);
          });
          return;
        }
        const ok = /VB-Audio Virtual Cable|CABLE Input|CABLE Output/i.test(stdout || '');
        resolve(!!ok);
      });
    } catch (e) {
      resolve(false);
    }
  });
}

// IPC for checking VB-CABLE
ipcMain.handle("check-vbcable", async () => {
  return await isVBCableInstalled();
});

// IPC: open VB-CABLE download page
ipcMain.handle('open-vbcable-download', async () => {
  await shell.openExternal('https://vb-audio.com/Cable/');
  return true;
});

// IPC: open Sound control panel (Playback tab)
ipcMain.handle('open-sound-playback', async () => {
  try {
    // control.exe mmsys.cpl,,0 opens Playback tab
    exec('control.exe mmsys.cpl,,0', { windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
});

// IPC: open Sound control panel (Recording tab)
ipcMain.handle('open-sound-recording', async () => {
  try {
    // control.exe mmsys.cpl,,1 opens Recording tab
    exec('control.exe mmsys.cpl,,1', { windowsHide: true });
    return true;
  } catch (e) {
    return false;
  }
});

// IPC: download/save conversation history to a text file
ipcMain.handle('download-history', async (event, args) => {
  try {
    const content = (args && args.content) || '';
    const suggestedName = (args && args.suggestedName) || 'transcript.txt';
    const win = overlayWindow instanceof BrowserWindow ? overlayWindow : null;
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Transcript',
      defaultPath: suggestedName,
      filters: [
        { name: 'Text Files', extensions: ['txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC handlers
ipcMain.handle("start-transcription", (event, args) =>
  transcription.start(overlayWindow, args)
);

ipcMain.handle("stop-transcription", () => transcription.stop());

// Handle window close request
ipcMain.on('close-window', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
});

// Handle window minimize request
ipcMain.on('minimize-window', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.minimize();
  }
});

// Lifecycle
app.whenReady().then(() => {
  overlayWindow = createOverlay();
});

// Lifecycle cleanup
app.on("window-all-closed", () => {
  transcription.stop();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  transcription.stop();
});

// --- NEW: manual Q&A ---
ipcMain.handle("ask-gemini", async (event, question) => {
  try {
    const answer = await transcription.askGemini(question);
    overlayWindow.webContents.send("qa-response", answer);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
