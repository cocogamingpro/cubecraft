const { app, BrowserWindow, Menu, shell } = require("electron");

// >>> CHANGE THIS to your own Render address (the https://....onrender.com link of your game) <<<
const GAME_URL = process.env.GAME_URL || "https://cubecraft-p1gq.onrender.com";

let win;

function waitingPage(message) {
  const html = `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:#111;color:#ddd;font-family:sans-serif;text-align:center">
    <div><h2>Block Platform</h2><p>${message}</p></div></body>`;
  return "data:text/html;charset=utf-8," + encodeURIComponent(html);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: "#000000",
    title: "Block Platform",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);

  // If the server is asleep or you're offline, show a message and keep retrying.
  win.webContents.on("did-fail-load", (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || url.startsWith("data:")) return; // -3 = navigation replaced
    win.loadURL(waitingPage("Connecting to the server... (it may be waking up, this can take a minute)"));
    setTimeout(() => { if (win && !win.isDestroyed()) win.loadURL(GAME_URL); }, 5000);
  });

  // F11 toggles fullscreen.
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });

  // Links that open new windows go to the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(GAME_URL);
  win.on("closed", () => { win = null; });
}

// Only one copy of the app at a time.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(createWindow);
  app.on("window-all-closed", () => app.quit());
}
