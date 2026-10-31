// The only things the room page can do: receive stats, open one of three fixed places, show the menu, and be dragged.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("roomDesk", {
  onStats: (fn) => ipcRenderer.on("room:stats", (_e, s) => fn(s)),
  onScale: (fn) => ipcRenderer.on("room:scale", (_e, s) => fn(Number(s) || 2)),
  open: (kind) => { if (["downloads", "storage", "privacy"].includes(kind)) ipcRenderer.send("room:open", kind); },
  menu: () => ipcRenderer.send("room:menu"),
  ready: () => ipcRenderer.send("room:ready"),
  dragStart: () => ipcRenderer.send("room:drag-start"),
  drag: () => ipcRenderer.send("room:drag"),
  dragEnd: (moved) => ipcRenderer.send("room:drag-end", !!moved),
});
