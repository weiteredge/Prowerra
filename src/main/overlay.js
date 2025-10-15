const { BrowserWindow, app } = require("electron");
const path = require("path");
const fs = require("fs");

function createOverlay() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "build", "icon.ico")
    : path.join(__dirname, "..", "..", "build", "icon.ico");

  const overlayWindow = new BrowserWindow({
    width: 650,
    height: 540,
    icon: iconPath,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    transparent: true,
    frame: false,
    resizable: true,
    minWidth: 600,
    minHeight: 400,
    movable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  // Prevent minimizing to avoid taskbar flashes
  try { overlayWindow.setMinimizable(false); } catch (_) {}

  // Ensure the window never shows a taskbar icon by applying skipTaskbar before showing
  try {
    overlayWindow.setSkipTaskbar(true);
    overlayWindow.on('ready-to-show', () => {
      try {
        overlayWindow.setSkipTaskbar(true);
        // Show without activating/focusing the window (prevents taskbar flash)
        if (typeof overlayWindow.showInactive === 'function') {
          overlayWindow.showInactive();
        } else {
          overlayWindow.show();
        }
      } catch (_) {}
    });
    overlayWindow.on('show', () => {
      try { overlayWindow.setSkipTaskbar(true); } catch (_) {}
    });
    overlayWindow.on('focus', () => {
      try { overlayWindow.setSkipTaskbar(true); } catch (_) {}
    });
  } catch (_) {
    // ignore
  }

  // Prevent this window from being captured by screen sharing/recording tools
  try {
    overlayWindow.setContentProtection(true);
  } catch (e) {
    console.warn('⚠️ Could not enable content protection', e);
  }

  // Load the overlay HTML from src/renderer/pages
  const htmlPath = path.join(__dirname, "..", "renderer", "pages", "overlay.html");
  overlayWindow.loadFile(htmlPath);

  // Constrain movement to horizontal only by locking the initial Y
  const initialBounds = overlayWindow.getBounds();
  const fixedY = initialBounds.y;
  overlayWindow.on('will-move', (event, newBounds) => {
    if (newBounds && typeof newBounds.y === 'number' && newBounds.y !== fixedY) {
      event.preventDefault();
      overlayWindow.setBounds({
        x: newBounds.x,
        y: fixedY,
        width: newBounds.width,
        height: newBounds.height,
      });
    }
  });

  try {
    let nativeModulePath;

    if (app.isPackaged) {
      nativeModulePath = path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "native",
        "build",
        "Release",
        "display_affinity.node"
      );
    } else {
      nativeModulePath = path.join(
        __dirname,
        "..",
        "..",
        "native",
        "build",
        "Release",
        "display_affinity.node"
      );
    }

    const affinity = require(nativeModulePath);
    const hwnd = overlayWindow.getNativeWindowHandle().readBigInt64LE();
    affinity.exclude(Number(hwnd)); // Hide overlay from screen share
  } catch (e) {
    console.warn(
      "⚠️ Display affinity not loaded, overlay may show in screen share.",
      e
    );
  }

  return overlayWindow;
}

module.exports = { createOverlay };
