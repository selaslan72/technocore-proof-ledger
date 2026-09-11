const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ledgerDesktop", {
  chooseDirectory: () => ipcRenderer.invoke("choose-directory"),
  startWatch: (input) => ipcRenderer.invoke("start-watch", input),
  stopWatch: (room) => ipcRenderer.invoke("stop-watch", room),
  openArchive: (directory) => ipcRenderer.invoke("open-archive", directory),
  getState: () => ipcRenderer.invoke("watch-state"),
  onState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("watch-status", listener);
    return () => ipcRenderer.removeListener("watch-status", listener);
  }
});
