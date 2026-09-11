import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchRoomUpdates, parseJsonRecord, validateRoom } from "./ledger.mjs";

const STATE_VERSION = 1;

function archiveEntries(jsonl) {
  if (!jsonl.trim()) return [];
  return jsonl.split(/\r?\n/).filter(Boolean).map((line, index) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      throw new Error(`invalid JSONL update at line ${index + 1}`);
    }
    if (!record || typeof record !== "object" || !Number.isSafeInteger(record.seq) || record.seq < 1) {
      throw new Error(`update at line ${index + 1} must have a positive safe-integer seq`);
    }
    return { line, seq: record.seq };
  });
}

function jsonArrayObjects(json, property) {
  const marker = new RegExp(`"${property}"\\s*:\\s*\\[`, "g");
  const match = marker.exec(json);
  if (!match) throw new Error(`Technocore JSON reply has no ${property} array`);
  const objects = [];
  let start = -1;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = match.index + match[0].length; index < json.length; index += 1) {
    const character = json[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character === "}") {
      depth -= 1;
      if (depth < 0) throw new Error("Technocore JSON reply has malformed messages");
      if (depth === 0) objects.push(json.slice(start, index + 1));
      continue;
    }
    if (character === "]" && depth === 0) return objects;
  }
  throw new Error("Technocore JSON reply has an unfinished messages array");
}

function responseEntries(json) {
  let view;
  try {
    view = JSON.parse(json);
  } catch {
    throw new Error("Technocore did not return valid JSON for the room reader");
  }
  if (!view || typeof view !== "object" || !Array.isArray(view.messages)) {
    throw new Error("Technocore JSON reply has no messages array");
  }
  const rawMessages = jsonArrayObjects(json, "messages");
  if (rawMessages.length !== view.messages.length) throw new Error("Technocore JSON reply has an unreadable messages array");
  return {
    firstSeq: view.first_seq,
    entries: rawMessages.map((raw, index) => {
      const record = parseJsonRecord(raw, index + 1);
      if (!record || typeof record !== "object" || !Number.isSafeInteger(record.seq) || record.seq < 1) {
        throw new Error(`update at line ${index + 1} must have a positive safe-integer seq`);
      }
      // Normalize indentation only. parseJsonRecord turns a numeric nonce into
      // its original decimal string before JSON.stringify can round it.
      return { line: JSON.stringify(record), seq: record.seq };
    })
  };
}

async function optionalRead(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function archiveHighWaterMark(archivePath) {
  const archive = await optionalRead(archivePath);
  if (archive === undefined) return 0;
  return archiveEntries(archive).reduce((highest, entry) => Math.max(highest, entry.seq), 0);
}

async function loadState(statePath, { baseUrl, room }) {
  const text = await optionalRead(statePath);
  if (text === undefined) return undefined;
  let state;
  try {
    state = JSON.parse(text);
  } catch {
    throw new Error("watch state is not valid JSON");
  }
  if (
    state?.schemaVersion !== STATE_VERSION ||
    state.room !== room ||
    state.baseUrl !== new URL(baseUrl).origin ||
    !Number.isSafeInteger(state.lastSeq) || state.lastSeq < 0
  ) {
    throw new Error("watch state does not match this public room");
  }
  return state;
}

async function saveState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporary = `${statePath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statePath);
}

/**
 * Fetch one public update cycle and append only unseen messages to a local
 * JSONL archive. The archive is written before the checkpoint; startup reads
 * its high-water mark too, so a stop between those two writes only causes a
 * harmless checkpoint repair, never a duplicate append.
 */
export async function watchOnce({
  baseUrl = "https://technocore.chat",
  room,
  archivePath,
  statePath,
  waitSeconds = 10,
  fetchImpl = fetch,
  timeoutMs = 60_000,
  maxBytes = 25 * 1024 * 1024,
  now = () => new Date().toISOString()
}) {
  validateRoom(room);
  const archive = resolve(archivePath);
  const stateFile = resolve(statePath);
  const savedState = await loadState(stateFile, { baseUrl, room });
  const archiveSeq = await archiveHighWaterMark(archive);
  const since = Math.max(savedState?.lastSeq ?? 0, archiveSeq);
  const response = await fetchRoomUpdates(baseUrl, room, since, { waitSeconds, fetchImpl, timeoutMs, maxBytes });
  const { entries: parsedEntries, firstSeq } = responseEntries(response);
  const bySeq = new Map();
  for (const entry of parsedEntries) {
    if (entry.seq > since && !bySeq.has(entry.seq)) bySeq.set(entry.seq, entry);
  }
  const entries = [...bySeq.values()].sort((a, b) => a.seq - b.seq);

  if (entries.length) {
    await mkdir(dirname(archive), { recursive: true });
    await appendFile(archive, `${entries.map((entry) => entry.line).join("\n")}\n`, { mode: 0o600 });
  }
  const lastSeq = entries.length ? entries.at(-1).seq : since;
  const state = {
    schemaVersion: STATE_VERSION,
    baseUrl: new URL(baseUrl).origin,
    room,
    lastSeq,
    updatedAt: now()
  };
  await saveState(stateFile, state);
  const gapDetected = Number.isSafeInteger(firstSeq) && firstSeq > since + 1;
  return { received: parsedEntries.length, appended: entries.length, lastSeq, gapDetected, archivePath: archive, statePath: stateFile };
}

export async function watchRoom(options) {
  const { once = false, pollDelayMs = 0, onCycle = () => {} } = options;
  do {
    const result = await watchOnce(options);
    onCycle(result);
    if (once) return result;
    if (pollDelayMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, pollDelayMs));
  } while (true);
}
