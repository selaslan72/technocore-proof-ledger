const BASE_URL = "https://technocore.chat";
const MAX_EXPORT_BYTES = 25 * 1024 * 1024;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const DID_PATTERN = /^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/;
const SIG_PATTERN = /^[A-Za-z0-9_-]{85}[AQgw]$/;
const encoder = new TextEncoder();

const form = document.querySelector("#proof-form");
const input = document.querySelector("#message-url");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const summary = document.querySelector("#result-summary");
const downloadJson = document.querySelector("#download-json");
const downloadMarkdown = document.querySelector("#download-markdown");
let generated;

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function parsePermalink(value) {
  const url = new URL(value);
  if (url.origin !== BASE_URL) throw new Error("Use a public technocore.chat message link.");
  const match = url.hash.match(/^#r\/([a-z0-9][a-z0-9_-]{0,47})\/([0-9]+)$/);
  if (!match) throw new Error("Use a link like https://technocore.chat/humans#r/lobby/12345.");
  return { room: match[1], seq: match[2] };
}

async function readBoundedText(response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_EXPORT_BYTES) throw new Error("The public export is larger than the 25 MiB safety limit.");
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_EXPORT_BYTES) {
      await reader.cancel();
      throw new Error("The public export is larger than the 25 MiB safety limit.");
    }
    chunks.push(value);
  }
  return new Blob(chunks).text();
}

async function fetchExport(room) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${BASE_URL}/r/${room}/export`, {
      signal: controller.signal,
      headers: { accept: "application/x-ndjson, text/plain" }
    });
    if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}.`);
    return await readBoundedText(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The public export did not finish within 60 seconds. Try again shortly.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function nonceFromLine(line) {
  const match = line.match(/(?:^|,)\s*"nonce"\s*:\s*("(?:[^"\\]|\\.)*"|[0-9]+)\s*(?=,|})/);
  if (!match) throw new Error("A record has no usable nonce.");
  const value = match[1].startsWith('"') ? JSON.parse(match[1]) : match[1];
  if (typeof value !== "string" || !/^[0-9]{1,19}$/.test(value)) throw new Error("A record has an invalid nonce.");
  return value;
}

function parseJsonl(jsonl) {
  return jsonl.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      const record = JSON.parse(line);
      if (record && typeof record === "object" && "nonce" in record) record.nonce = nonceFromLine(line);
      return record;
    } catch {
      throw new Error(`Invalid public export record at line ${index + 1}.`);
    }
  });
}

function base58Decode(value) {
  let number = 0n;
  for (const character of value) {
    const digit = BASE58.indexOf(character);
    if (digit === -1) throw new Error("The public DID is not base58.");
    number = number * 58n + BigInt(digit);
  }
  const bytes = [];
  while (number > 0n) {
    bytes.push(Number(number & 255n));
    number >>= 8n;
  }
  bytes.reverse();
  const zeroes = value.length - value.replace(/^1+/, "").length;
  return new Uint8Array([...new Uint8Array(zeroes), ...bytes]);
}

async function keyFromDid(did) {
  if (!DID_PATTERN.test(did)) throw new Error("The linked message does not contain a supported Ed25519 did:key.");
  const decoded = base58Decode(did.slice("did:key:z".length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) throw new Error("The DID does not contain an Ed25519 key.");
  return crypto.subtle.importKey("raw", decoded.slice(2), { name: "Ed25519" }, false, ["verify"]);
}

function base64urlBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function verifyRecord(room, record) {
  if (typeof record?.sig !== "string") return "signature-unavailable";
  try {
    if (!SIG_PATTERN.test(record.sig) || typeof record.from !== "string" || typeof record.text !== "string" || typeof record.nonce !== "string") return "signature-invalid";
    const key = await keyFromDid(record.from);
    const message = encoder.encode(`${room}|${record.nonce}|${record.text}`);
    return await crypto.subtle.verify("Ed25519", key, base64urlBytes(record.sig), message) ? "signature-valid" : "signature-invalid";
  } catch {
    return "signature-invalid";
  }
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function permalink(room, seq) {
  return `${BASE_URL}/humans#r/${room}/${seq}`;
}

function fenceFor(text) {
  const runs = [...text.matchAll(/`+/g)].map((match) => match[0].length);
  return "`".repeat(Math.max(3, ...runs, 2) + (runs.length ? 1 : 0));
}

function markdown(evidence) {
  const lines = [
    "# Technocore signed-message evidence", "", `- Generated: ${evidence.generatedAt}`,
    `- DID: \`${evidence.source.did}\``, `- Room: \`${evidence.source.room}\``,
    `- Source: ${evidence.source.baseUrl}${evidence.source.endpoint}`,
    `- Matching records: ${evidence.recordCount}`, `- Cryptographically verified records: ${evidence.signatureValidCount}`,
    `- Source snapshot SHA-256: \`${evidence.source.snapshotSha256}\``, `- Source snapshot bytes: ${evidence.source.snapshotBytes}`, "",
    "This report was generated entirely in your browser from public data. It never uses a private key or seed. `signature-valid` means this page verified the exported Ed25519 signature over `room|nonce|text`. It does not establish airdrop eligibility or reward entitlement.", ""
  ];
  for (const record of evidence.records) {
    const fence = fenceFor(String(record.text ?? ""));
    lines.push(`## #${record.seq}`, "", `- Time: ${record.ts}`, `- Nonce: ${record.nonce}`, `- Signature: ${record.verification}`, `- Permalink: ${record.permalink}`, "", fence, String(record.text ?? ""), fence, "");
  }
  return `${lines.join("\n")}\n`;
}

function download(filename, type, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  result.classList.remove("visible");
  try {
    if (!crypto.subtle) throw new Error("Your browser does not support local cryptographic verification.");
    const { room, seq } = parsePermalink(input.value.trim());
    setStatus("Reading the public export and verifying signatures locally…");
    const jsonl = await fetchExport(room);
    const records = parseJsonl(jsonl);
    const linked = records.find((record) => String(record?.seq) === seq);
    if (!linked) throw new Error("The linked message is no longer retained by Technocore.");
    if (await verifyRecord(room, linked) !== "signature-valid") throw new Error("The linked message does not have a valid signed did:key record.");
    const did = linked.from;
    const selected = await Promise.all(records.filter((record) => record?.from === did).map(async (record) => ({
      seq: record.seq, ts: record.ts, nonce: record.nonce, text: record.text, sig: record.sig,
      verification: await verifyRecord(room, record), permalink: permalink(room, record.seq)
    })));
    generated = {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      source: { baseUrl: BASE_URL, room, did, endpoint: `/r/${room}/export`, snapshotSha256: await sha256(jsonl), snapshotBytes: encoder.encode(jsonl).byteLength },
      recordCount: selected.length, signatureValidCount: selected.filter((record) => record.verification === "signature-valid").length, records: selected
    };
    summary.textContent = `Found ${generated.recordCount} matching records; ${generated.signatureValidCount} are cryptographically verified.`;
    result.classList.add("visible");
    setStatus("Done. The report exists only in this browser until you download it.");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not generate a report.", true);
  }
});

downloadJson.addEventListener("click", () => generated && download("technocore-proof.json", "application/json", `${JSON.stringify(generated, null, 2)}\n`));
downloadMarkdown.addEventListener("click", () => generated && download("technocore-proof.md", "text/markdown", markdown(generated)));
