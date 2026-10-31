// Tiny Room — a pixel bedroom on your desktop that shows how your Mac is doing.
// The main process reads a few harmless stats (CPU, disk, Downloads, idle time, uptime) and sends them to the room.
const { app, BrowserWindow, Menu, ipcMain, powerMonitor, screen, session, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");

app.setName("Tiny Room");
if (!app.requestSingleInstanceLock()) app.quit();

/* ---------- settings ---------- */
const DEFAULTS = { pos: null, onTop: false, size: "M" };
const SIZES = { S: 1.5, M: 2, L: 3 };
let cfg = { ...DEFAULTS };
const cfgFile = () => path.join(app.getPath("userData"), "settings.json");
function loadCfg() { try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgFile(), "utf8")) }; } catch { cfg = { ...DEFAULTS }; } if (!SIZES[cfg.size]) cfg.size = "M"; }
function saveCfg() { try { fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2)); } catch { /* fine */ } }
const dims = () => { const s = SIZES[cfg.size]; return { w: Math.round(176 * s + 24), h: Math.round(146 * s + 48) }; };

let win = null;
function lockDown(wc) {
  wc.setWindowOpenHandler(() => ({ action: "deny" }));
  wc.on("will-navigate", (e) => e.preventDefault());
  wc.on("will-attach-webview", (e) => e.preventDefault());
}
function onAScreen(p, w, h) {
  return p && screen.getAllDisplays().some(({ workArea: a }) => p.x + w / 2 > a.x && p.x + w / 2 < a.x + a.width && p.y + h / 2 > a.y && p.y + h / 2 < a.y + a.height);
}
function createWindow() {
  const { w, h } = dims(), a = screen.getPrimaryDisplay().workArea;
  const pos = onAScreen(cfg.pos, w, h) ? cfg.pos : { x: a.x + a.width - w - 30, y: a.y + 40 };
  win = new BrowserWindow({
    width: w, height: h, x: Math.round(pos.x), y: Math.round(pos.y),
    frame: false, transparent: true, backgroundColor: "#00000000", hasShadow: false,
    resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, show: false, title: "Tiny Room",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  lockDown(win.webContents);
  win.setAlwaysOnTop(!!cfg.onTop, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.once("ready-to-show", () => win.showInactive());
  win.on("closed", () => { win = null; });
}
function resize() {
  if (!win) return;
  const { w, h } = dims(), [x, y] = win.getPosition();
  win.setBounds({ x, y, width: w, height: h });
  win.webContents.send("room:scale", SIZES[cfg.size]);
}

/* ---------- stats ---------- */
let prev = null;
function cpuNow() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) { for (const k in c.times) total += c.times[k]; idle += c.times.idle; }
  const out = prev ? 1 - (idle - prev.idle) / Math.max(1, total - prev.total) : 0;
  prev = { idle, total };
  return Math.max(0, Math.min(1, out));
}
function diskNow() {
  try { const s = fs.statfsSync(os.homedir()); return { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { return { total: 1, free: 1 }; }
}
let dl = { ok: true, count: 0, bytes: 0, week: 0 };
async function scanDownloads() {
  try {
    const dir = app.getPath("downloads");
    const items = (await fs.promises.readdir(dir, { withFileTypes: true })).filter((d) => !d.name.startsWith("."));
    let bytes = 0, week = 0; const weekAgo = Date.now() - 7 * 864e5;
    for (const d of items) {
      try { const st = await fs.promises.stat(path.join(dir, d.name)); if (d.isFile()) bytes += st.size; if ((st.birthtimeMs || st.mtimeMs) > weekAgo) week++; } catch { /* skip */ }
    }
    dl = { ok: true, count: items.length, bytes, week };
  } catch { dl = { ok: false, count: 0, bytes: 0, week: 0 }; }
}
let disk = diskNow();
function tick() {
  if (!win) return;
  win.webContents.send("room:stats", { cpu: cpuNow(), cores: os.cpus().length, disk, dl, idle: powerMonitor.getSystemIdleTime(), uptime: os.uptime() });
}

/* ---------- menu (right-click the room) ---------- */
function menu() {
  return Menu.buildFromTemplate([
    { label: "Tiny Room", enabled: false },
    { type: "separator" },
    { label: "Keep above windows", type: "checkbox", checked: !!cfg.onTop, click: (i) => { cfg.onTop = i.checked; saveCfg(); if (win) win.setAlwaysOnTop(i.checked, "floating"); } },
    { label: "Size", submenu: [["S", "Small"], ["M", "Medium"], ["L", "Large"]].map(([k, l]) => ({ label: l, type: "radio", checked: cfg.size === k, click: () => { cfg.size = k; saveCfg(); resize(); } })) },
    { label: "Open at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { type: "separator" },
    { label: "Quit Tiny Room", click: () => app.quit() },
  ]);
}

/* ---------- messages from the room ---------- */
const fromWin = (e) => win && e.sender === win.webContents;
const OPEN = {
  downloads: () => shell.openPath(app.getPath("downloads")),
  storage: () => shell.openExternal("x-apple.systempreferences:com.apple.settings.Storage"),
  privacy: () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"),
};
ipcMain.on("room:ready", (e) => { if (fromWin(e)) { win.webContents.send("room:scale", SIZES[cfg.size]); tick(); } });
ipcMain.on("room:open", (e, kind) => { if (fromWin(e) && OPEN[kind]) OPEN[kind](); });
ipcMain.on("room:menu", (e) => { if (fromWin(e)) menu().popup({ window: win }); });
let drag = null;
ipcMain.on("room:drag-start", (e) => { if (fromWin(e)) { const [x, y] = win.getPosition(); drag = { c: screen.getCursorScreenPoint(), x, y }; } });
ipcMain.on("room:drag", (e) => { if (!fromWin(e) || !drag) return; const c = screen.getCursorScreenPoint(); win.setPosition(Math.round(drag.x + c.x - drag.c.x), Math.round(drag.y + c.y - drag.c.y)); });
ipcMain.on("room:drag-end", (e, moved) => { if (!fromWin(e)) return; drag = null; if (moved) { const [x, y] = win.getPosition(); cfg.pos = { x, y }; saveCfg(); } });

/* ---------- start ---------- */
app.whenReady().then(() => {
  loadCfg();
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  if (process.platform === "darwin" && app.dock) app.dock.hide(); // a desktop ornament, not a Dock app
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }]));
  createWindow();
  cpuNow();
  scanDownloads();
  setInterval(tick, 2000);
  setInterval(() => { disk = diskNow(); }, 30000);
  setInterval(scanDownloads, 60000);
});
app.on("second-instance", () => { if (win) win.showInactive(); });
app.on("window-all-closed", () => app.quit());
