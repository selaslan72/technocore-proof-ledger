const ROOM_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function validateRoom(room) {
  if (!ROOM_PATTERN.test(room)) {
    throw new Error("room must match ^[a-z0-9][a-z0-9_-]{0,47}$");
  }
  return room;
}

export function validateDid(did) {
  if (typeof did !== "string" || !did.startsWith("did:key:z")) {
    throw new Error("did must be a public did:key identifier");
  }
  return did;
}

export function parseJsonl(jsonl) {
  return jsonl
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch {
        throw new Error(`invalid JSONL record at line ${index + 1}`);
      }
    });
}

export function selectSignedRecords(records, did) {
  validateDid(did);
  return records
    .filter((record) => record?.from === did)
    .map((record) => ({
      ...record,
      verification: typeof record.sig === "string" ? "signature-present" : "signature-unavailable"
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

export function makeEvidence({ baseUrl, room, did, records, fetchedAt = new Date().toISOString() }) {
  validateRoom(room);
  validateDid(did);
  const signedRecords = selectSignedRecords(records, did).map((record) => ({
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
    source: { baseUrl: new URL(baseUrl).origin, room, did, endpoint: `/r/${room}/export` },
    recordCount: signedRecords.length,
    records: signedRecords
  };
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
    "",
    "This report is read-only. It never creates, imports, transmits, or stores a private key or seed.",
    ""
  ];
  for (const record of evidence.records) {
    lines.push(`## #${record.seq}`, "", `- Time: ${record.ts}`, `- Nonce: ${record.nonce}`, `- Signature: ${record.verification}`, `- Permalink: ${record.permalink}`, "", record.text, "");
  }
  return `${lines.join("\n")}\n`;
}

export async function fetchRoomExport(baseUrl, room, { fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  validateRoom(room);
  const url = new URL(`/r/${room}/export`, baseUrl);
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: "application/x-ndjson, text/plain" } });
  if (!response.ok) throw new Error(`Technocore returned HTTP ${response.status}`);
  return response.text();
}

/** Resolve a public DID from the exact signed message named by a permalink. */
export async function resolveDidFromPermalink(messageUrl, { baseUrl = "https://technocore.chat", fetchImpl = fetch, timeoutMs = 60_000 } = {}) {
  const { room, seq } = parseMessagePermalink(messageUrl, baseUrl);
  // The live room view is deliberately transient. Resolve against the same
  // raw export that becomes the evidence source, so the identified record and
  // the report are drawn from one retained public snapshot.
  const records = parseJsonl(await fetchRoomExport(baseUrl, room, { fetchImpl, timeoutMs }));
  const record = records.find((message) => message?.seq === seq);
  if (!record) throw new Error("the linked message is no longer retained by Technocore; use --did if you saved the public DID");
  if (typeof record.sig !== "string") throw new Error("the linked message is not a signed did:key message");
  return { room, seq, did: validateDid(record.from), records };
}
