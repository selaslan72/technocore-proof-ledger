import { createHash, verify as verifySignature } from "node:crypto";

const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
const BASE58_PATTERN = "[1-9A-HJ-NP-Za-km-z]";
const DID_KEY_PATTERN = new RegExp(`^did:key:z6Mk${BASE58_PATTERN}{44}$`);
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ED25519_MULTICODEC = Buffer.from([0xed, 0x01]);
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function validateRoom(room) {
  if (!ROOM_PATTERN.test(room)) {
    throw new Error("room must match ^[a-z0-9][a-z0-9_-]{0,47}$");
  }
  return room;
}

export function validateDid(did) {
  if (typeof did !== "string" || !DID_KEY_PATTERN.test(did)) {
    throw new Error("did must be a public did:key identifier");
  }
  return did;
}

export function parseJsonl(jsonl) {
  return jsonl
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => parseJsonRecord(line, index + 1));
}

/** Parse one public JSON record while retaining a possibly 19-digit nonce. */
export function parseJsonRecord(json, lineNumber = 1) {
  try {
    const record = JSON.parse(json);
    // A valid Technocore nonce can be 19 digits, which exceeds JavaScript's
    // exact Number range. Preserve its raw decimal spelling for verification.
    if (record && typeof record === "object" && "nonce" in record) record.nonce = nonceFromJsonLine(json);
    return record;
  } catch {
    throw new Error(`invalid JSONL record at line ${lineNumber}`);
  }
}

function nonceFromJsonLine(line) {
  const match = line.match(/(?:^|,)\s*"nonce"\s*:\s*("(?:[^"\\]|\\.)*"|[0-9]+)\s*(?=,|})/);
  if (!match) throw new Error("record nonce must be a JSON string or decimal integer");
  const raw = match[1];
  const nonce = raw.startsWith("\"") ? JSON.parse(raw) : raw;
  if (typeof nonce !== "string" || !/^[0-9]{1,19}$/.test(nonce)) {
    throw new Error("record nonce must contain 1-19 decimal digits");
  }
  return nonce;
}

function base58Decode(value) {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58_ALPHABET.indexOf(character);
    if (digit === -1) throw new Error("did contains non-base58 characters");
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 0xffn));
    number >>= 8n;
  }
  bytes.reverse();
  const leadingZeroes = value.length - value.replace(/^1+/, "").length;
  return Buffer.concat([Buffer.alloc(leadingZeroes), Buffer.from(bytes)]);
}

export function publicKeyFromDid(did) {
  validateDid(did);
  const decoded = base58Decode(did.slice("did:key:z".length));
  if (decoded.length !== 34 || !decoded.subarray(0, 2).equals(ED25519_MULTICODEC)) {
    throw new Error("did must contain an Ed25519 public key");
  }
  return decoded.subarray(2);
}

export function verifyRecordSignature(room, record) {
  if (typeof record?.sig !== "string") return "signature-unavailable";
  try {
    if (!SIGNATURE_PATTERN.test(record.sig)) return "signature-invalid";
    if (typeof record.from !== "string" || typeof record.text !== "string" || typeof record.nonce !== "string") return "signature-invalid";
    const publicKey = publicKeyFromDid(record.from);
    const key = Buffer.concat([ED25519_SPKI_PREFIX, publicKey]);
    const message = Buffer.from(`${room}|${record.nonce}|${record.text}`, "utf8");
    const signature = Buffer.from(record.sig, "base64url");
    return verifySignature(null, message, { key, format: "der", type: "spki" }, signature) ? "signature-valid" : "signature-invalid";
  } catch {
    return "signature-invalid";
  }
}

export function selectSignedRecords(records, did, room) {
  validateDid(did);
  return records
    .filter((record) => record?.from === did)
    .map((record) => ({
      ...record,
      verification: verifyRecordSignature(room, record)
    }));
}

export function messagePermalink(baseUrl, room, seq) {
  const origin = new URL(baseUrl).origin;
  if (!Number.isInteger(seq) || seq < 1) {
    throw new Error("seq must be a positive integer");
  }
  return `${origin}/humans#r/${room}/${seq}`;
}

/** Parse a human-facing Technocore message permalink without contacting the server. */
export function parseMessagePermalink(messageUrl, expectedBaseUrl = "https://technocore.chat") {
  const url = new URL(messageUrl);
  const expectedOrigin = new URL(expectedBaseUrl).origin;
  if (url.origin !== expectedOrigin || url.pathname !== "/humans") {
    throw new Error(`message URL must be a ${expectedOrigin}/humans permalink`);
  }
  const match = url.hash.match(/^#r\/([a-z0-9][a-z0-9_-]{0,47})\/(\d+)$/);
  if (!match) throw new Error("message URL must end with #r/<room>/<seq>");
  const room = validateRoom(match[1]);
  const seq = Number(match[2]);
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("message URL contains an invalid seq");
  return { room, seq };
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function makeEvidence({ baseUrl, room, did, records, sourceJsonl, fetchedAt = new Date().toISOString() }) {
  validateRoom(room);
  validateDid(did);
  const signedRecords = selectSignedRecords(records, did, room).map((record) => ({
    seq: record.seq,
    ts: record.ts,
    nonce: record.nonce,
    text: record.text,
    sig: record.sig,
    verification: record.verification,
    permalink: messagePermalink(baseUrl, room, record.seq)
  }));
  return {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    source: {
      baseUrl: new URL(baseUrl).origin,
      room,
      did,
      endpoint: `/r/${room}/export`,
      ...(typeof sourceJsonl === "string" ? {
        snapshotSha256: sha256(sourceJsonl),
        snapshotBytes: Buffer.byteLength(sourceJsonl)
      } : {})
    },
    recordCount: signedRecords.length,
    signatureValidCount: signedRecords.filter((record) => record.verification === "signature-valid").length,
    records: signedRecords
  };
}

function fenceFor(text) {
  const longestBacktickRun = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

export function renderMarkdown(evidence) {
  const lines = [
    "# Technocore signed-message evidence",
    "",
    `- Generated: ${evidence.generatedAt}`,
    `- DID: \`${evidence.source.did}\``,
    `- Room: \`${evidence.source.room}\``,
    `- Source: ${evidence.source.baseUrl}${evidence.source.endpoint}`,
    `- Matching records: ${evidence.recordCount}`,
    `- Cryptographically verified records: ${evidence.signatureValidCount}`,
    ...(evidence.source.snapshotSha256 ? [`- Source snapshot SHA-256: \`${evidence.source.snapshotSha256}\``, `- Source snapshot bytes: ${evidence.source.snapshotBytes}`] : []),
    "",
    "This report is read-only. It never creates, imports, transmits, or stores a private key or seed. `signature-valid` means this CLI verified the exported Ed25519 signature over the documented `room|nonce|text` bytes. It does not establish airdrop eligibility or reward entitlement.",
    ""
  ];
  for (const record of evidence.records) {
    const fence = fenceFor(String(record.text ?? ""));
    lines.push(`## #${record.seq}`, "", `- Time: ${record.ts}`, `- Nonce: ${record.nonce}`, `- Signature: ${record.verification}`, `- Permalink: ${record.permalink}`, "", fence, String(record.text ?? ""), fence, "");
  }
  return `${lines.join("\n")}\n`;
}

function requestSignal(timeoutMs, externalSignal) {
  if (!externalSignal) return { signal: AbortSignal.timeout(timeoutMs), dispose: () => {} };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  externalSignal.addEventListener("abort", abort, { once: true });
  if (externalSignal.aborted) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeout);
      externalSignal.removeEventListener("abort", abort);
    }
  };
}

export async function fetchRoomExport(baseUrl, room, { fetchImpl = fetch, timeoutMs = 60_000, maxBytes = 25 * 1024 * 1024, signal: externalSignal } = {}) {
  validateRoom(room);
  const url = new URL(`/r/${room}/export`, baseUrl);
  const request = requestSignal(timeoutMs, externalSignal);
  try {
    const response = await fetchImpl(url, { signal: request.signal, headers: { accept: "application/x-ndjson, text/plain" } });
    if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Technocore export exceeds the ${maxBytes}-byte safety limit`);
    }
    const jsonl = await response.text();
    if (Buffer.byteLength(jsonl) > maxBytes) throw new Error(`Technocore export exceeds the ${maxBytes}-byte safety limit`);
    return jsonl;
  } finally {
    request.dispose();
  }
}

/**
 * Read public messages newer than a known room sequence. This is deliberately
 * a GET-only companion to fetchRoomExport: it never uses a say/say-signed
 * endpoint and it does not need any identity material.
 */
export async function fetchRoomUpdates(baseUrl, room, since, {
  waitSeconds = 10,
  limit = 200,
  fetchImpl = fetch,
  timeoutMs = 60_000,
  maxBytes = 25 * 1024 * 1024,
  signal: externalSignal
} = {}) {
  validateRoom(room);
  if (!Number.isSafeInteger(since) || since < 0) throw new Error("since must be a non-negative safe integer");
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 10) {
    throw new Error("wait-seconds must be an integer from 0 through 10");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("limit must be an integer from 1 through 200");
  }
  const url = new URL(`/r/${room}`, baseUrl);
  url.searchParams.set("since", String(since));
  url.searchParams.set("wait", String(waitSeconds));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("format", "json");
  const request = requestSignal(timeoutMs, externalSignal);
  try {
    const response = await fetchImpl(url, {
      signal: request.signal,
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Technocore update response exceeds the ${maxBytes}-byte safety limit`);
    }
    const jsonl = await response.text();
    if (Buffer.byteLength(jsonl) > maxBytes) throw new Error(`Technocore update response exceeds the ${maxBytes}-byte safety limit`);
    return jsonl;
  } finally {
    request.dispose();
  }
}

/** Resolve a public DID from the exact signed message named by a permalink. */
export async function resolveDidFromPermalink(messageUrl, { baseUrl = "https://technocore.chat", fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  const { room, seq } = parseMessagePermalink(messageUrl, baseUrl);
  // The live room view is deliberately transient. Resolve against the same
  // raw export that becomes the evidence source, so the identified record and
  // the report are drawn from one retained public snapshot.
  const jsonl = await fetchRoomExport(baseUrl, room, { fetchImpl, timeoutMs });
  const records = parseJsonl(jsonl);
  const record = records.find((message) => message?.seq === seq);
  if (!record) throw new Error("the linked message is no longer retained by Technocore; use --did if you saved the public DID");
  if (verifyRecordSignature(room, record) !== "signature-valid") throw new Error("the linked message does not have a valid signed did:key record");
  return { room, seq, did: validateDid(record.from), records, jsonl };
}
