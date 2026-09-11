const room = document.querySelector("#room");
const directory = document.querySelector("#directory");
const chooseDirectory = document.querySelector("#choose-directory");
const start = document.querySelector("#start");
const openFolder = document.querySelector("#open-folder");
const notice = document.querySelector("#notice");
const list = document.querySelector("#watch-list");
const empty = document.querySelector("#empty-state");

function setNotice(message, error = false) {
  notice.textContent = message;
  notice.classList.toggle("error", error);
}

function render(watches) {
  empty.hidden = watches.length > 0;
  list.replaceChildren();
  for (const watch of watches) {
    const item = document.createElement("article");
    item.className = `watch${watch.state === "error" ? " error" : ""}`;
    const title = document.createElement("h3");
    title.textContent = `#${watch.room} · ${watch.state}`;
    const details = document.createElement("p");
    details.textContent = `Checkpoint: #${watch.lastSeq || 0} · last cycle: ${watch.appended || 0} new of ${watch.received || 0} received`;
    const path = document.createElement("p");
    path.textContent = watch.archivePath;
    item.append(title, details, path);
    if (watch.gapDetected || watch.error) {
      const warning = document.createElement("p");
      warning.className = "warning";
      warning.textContent = watch.error || "Retention warning: older records were already unavailable from the server.";
      item.append(warning);
    }
    if (watch.state !== "stopping") {
      const stop = document.createElement("button");
      stop.className = "stop";
      stop.textContent = "Stop archive";
      stop.addEventListener("click", async () => {
        await window.ledgerDesktop.stopWatch(watch.room);
      });
      item.append(stop);
    }
    list.append(item);
  }
}

chooseDirectory.addEventListener("click", async () => {
  const selected = await window.ledgerDesktop.chooseDirectory();
  if (!selected) return;
  directory.value = selected;
  start.disabled = false;
  openFolder.disabled = false;
  setNotice("Ready. The archive will stay only in the folder you selected.");
});

start.addEventListener("click", async () => {
  try {
    start.disabled = true;
    const started = await window.ledgerDesktop.startWatch({ room: room.value.trim(), directory: directory.value });
    setNotice(`Starting read-only archive for #${started.room}.`);
  } catch (error) {
    setNotice(error instanceof Error ? error.message : "Could not start the archive.", true);
  } finally {
    start.disabled = !directory.value;
  }
});

openFolder.addEventListener("click", () => window.ledgerDesktop.openArchive(directory.value));
window.ledgerDesktop.onState((payload) => {
  if (payload.type === "error") setNotice(payload.message, true);
  else render(payload.watches);
});
window.ledgerDesktop.getState().then(render);
