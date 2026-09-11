import { app, BrowserWindow, dialog, ipcMain, shell, session } from "electron";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoom } from "../src/ledger.mjs";
import { watchRoom } from "../src/watch.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const baseUrl = "https://technocore.chat";
const selectedDirectories = new Set();
const watchers = new Map();
let window;

function sendStatus(status) {
  if (!window?.isDestroyed()) window.webContents.send("watch-status", status);
}

function isTrustedSender(event) {
  return event.sender === window?.webContents;
}

function publicState() {
  return [...watchers.values()].map(({ room, archivePath, state, last }) => ({ room, archivePath, state, ...last }));
}

function requireDirectory(directory) {
  if (typeof directory !== "string") throw new Error("Choose a local archive folder first");
  const absolute = resolve(directory);
  if (!selectedDirectories.has(absolute)) throw new Error("Archive folder must be selected through this app");
  return absolute;
}

function safeRoom(value) {
  return validateRoom(value);
}

async function chooseDirectory(event) {
  if (!isTrustedSender(event)) throw new Error("Untrusted window");
  const result = await dialog.showOpenDialog(window, {
    title: "Choose a local archive folder",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const directory = resolve(result.filePaths[0]);
  selectedDirectories.add(directory);
  return directory;
}

async function startWatch(event, input) {
  if (!isTrustedSender(event)) throw new Error("Untrusted window");
  const room = safeRoom(input?.room);
  const directory = requireDirectory(input?.directory);
  if (watchers.has(room)) throw new Error(`Already watching ${room}`);
  await mkdir(directory, { recursive: true });
  const archivePath = join(directory, `${room}.jsonl`);
  const statePath = `${archivePath}.state.json`;
  const controller = new AbortController();
  const watcher = { room, archivePath, state: "starting", last: { received: 0, appended: 0, lastSeq: 0 }, controller };
  watchers.set(room, watcher);
  sendStatus({ type: "state", watches: publicState() });
  void watchRoom({
    baseUrl,
    room,
    archivePath,
    statePath,
    waitSeconds: 10,
    limit: 200,
    signal: controller.signal,
    onCycle: (result) => {
      watcher.state = "watching";
      watcher.last = result;
      sendStatus({ type: "state", watches: publicState() });
    },
    onError: (error) => {
      watcher.state = "error";
      watcher.last = { ...watcher.last, error: error.message };
      sendStatus({ type: "state", watches: publicState() });
      sendStatus({ type: "error", message: `Could not archive #${room}: ${error.message}` });
    }
  }).finally(() => {
    if (watchers.get(room) === watcher) {
      watchers.delete(room);
      sendStatus({ type: "state", watches: publicState() });
    }
  });
  return { room, archivePath };
}

function stopWatch(event, roomInput) {
  if (!isTrustedSender(event)) throw new Error("Untrusted window");
  const room = safeRoom(roomInput);
  const watcher = watchers.get(room);
  if (!watcher) return false;
  watcher.state = "stopping";
  watcher.controller.abort();
  sendStatus({ type: "state", watches: publicState() });
  return true;
}

async function openArchive(event, directory) {
  if (!isTrustedSender(event)) throw new Error("Untrusted window");
  const path = requireDirectory(directory);
  await shell.openPath(path);
}

function createWindow() {
  window = new BrowserWindow({
    width: 860,
    height: 680,
    minWidth: 660,
    minHeight: 560,
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });
  window.loadFile(join(here, "renderer", "index.html"));
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ipcMain.handle("choose-directory", chooseDirectory);
  ipcMain.handle("start-watch", startWatch);
  ipcMain.handle("stop-watch", stopWatch);
  ipcMain.handle("open-archive", openArchive);
  ipcMain.handle("watch-state", (event) => {
    if (!isTrustedSender(event)) throw new Error("Untrusted window");
    return publicState();
  });
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => {
  for (const watcher of watchers.values()) watcher.controller.abort();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
