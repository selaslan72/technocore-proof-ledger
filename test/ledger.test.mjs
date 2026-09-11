import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchRoomExport, makeEvidence, parseJsonl, renderMarkdown, resolveDidFromPermalink } from "../src/ledger.mjs";
import { watchOnce, watchRoom } from "../src/watch.mjs";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (value > 0n) {
    encoded = BASE58[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  return "1".repeat(bytes.findIndex((byte) => byte !== 0) === -1 ? bytes.length : bytes.findIndex((byte) => byte !== 0)) + encoded;
}

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const rawPublicKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
const did = `did:key:z${base58Encode(Buffer.concat([Buffer.from([0xed, 0x01]), rawPublicKey]))}`;

function signedRecord({ seq, room = "technocore", nonce = "9", text = "verified contribution" }) {
  return {
    seq,
    ts: "2026-09-09T00:00:00Z",
    from: did,
    nonce,
    text,
    sig: sign(null, Buffer.from(`${room}|${nonce}|${text}`, "utf8"), privateKey).toString("base64url")
  };
}

test("exports only matching signed records with stable permalinks", () => {
  const records = parseJsonl([
    JSON.stringify(signedRecord({ seq: 4 })),
    JSON.stringify({ seq: 5, ts: "2026-09-09T00:01:00Z", from: "~nick", text: "untrusted" }),
    JSON.stringify({ seq: 6, ts: "2026-09-09T00:02:00Z", from: did, nonce: 10, text: "legacy record" })
  ].join("\n"));
  const sourceJsonl = [
    JSON.stringify(signedRecord({ seq: 4 })),
    JSON.stringify({ seq: 5, ts: "2026-09-09T00:01:00Z", from: "~nick", text: "untrusted" }),
    JSON.stringify({ seq: 6, ts: "2026-09-09T00:02:00Z", from: did, nonce: 10, text: "legacy record" })
  ].join("\n");
  const evidence = makeEvidence({ baseUrl: "https://technocore.chat", room: "technocore", did, records, sourceJsonl, fetchedAt: "2026-09-09T00:03:00Z" });
  assert.equal(evidence.recordCount, 2);
  assert.equal(evidence.records[0].permalink, "https://technocore.chat/humans#r/technocore/4");
  assert.equal(evidence.records[0].verification, "signature-valid");
  assert.equal(evidence.records[1].verification, "signature-unavailable");
  assert.equal(evidence.signatureValidCount, 1);
  assert.match(evidence.source.snapshotSha256, /^[a-f0-9]{64}$/);
  assert.match(renderMarkdown(evidence), /This report is read-only/);
});

test("renders untrusted message text as a code block", () => {
  const evidence = makeEvidence({
    baseUrl: "https://technocore.chat",
    room: "technocore",
    did,
    records: [signedRecord({ seq: 7, nonce: "11", text: "# not a heading\n```\nuntrusted" })]
  });
  assert.match(renderMarkdown(evidence), /````\n# not a heading\n```\nuntrusted\n````/);
});

test("rejects malformed JSONL", () => {
  assert.throws(() => parseJsonl('{not json}'), /line 1/);
});

test("preserves a 19-digit nonce exactly", () => {
  const [record] = parseJsonl('{"seq":1,"nonce":9223372036854775807}');
  assert.equal(record.nonce, "9223372036854775807");
});

test("resolves a DID only from the exact signed message in a permalink", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url.toString(), "https://technocore.chat/r/technocore/export");
    return new Response(JSON.stringify(signedRecord({ seq: 42 })), { status: 200 });
  };
  const resolved = await resolveDidFromPermalink("https://technocore.chat/humans#r/technocore/42", { fetchImpl });
  const jsonl = JSON.stringify(signedRecord({ seq: 42 }));
  assert.deepEqual(resolved, { room: "technocore", seq: 42, did, records: [parseJsonl(jsonl)[0]], jsonl });
});

test("rejects a room export larger than the configured safety limit", async () => {
  const fetchImpl = async () => new Response("12345", { status: 200, headers: { "content-length": "5" } });
  await assert.rejects(fetchRoomExport("https://technocore.chat", "technocore", { fetchImpl, maxBytes: 4 }), /safety limit/);
});

test("does not resolve an unsigned message from a permalink", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ seq: 42, from: "~nick" }), { status: 200 });
  await assert.rejects(
    resolveDidFromPermalink("https://technocore.chat/humans#r/technocore/42", { fetchImpl }),
    /valid signed/
  );
});

test("watch appends unseen public records and repairs its checkpoint from the local archive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "technocore-proof-ledger-watch-"));
  const archivePath = join(directory, "lobby.jsonl");
  const statePath = join(directory, "lobby.state.json");
  const initialSnapshot = [
    '{"seq":7,"ts":"2026-09-11T10:00:00Z","from":"~nick","text":"public one","nonce":9223372036854775807}',
    JSON.stringify(signedRecord({ seq: 8, room: "lobby", nonce: "12", text: "public two" }))
  ].join("\n");
  const secondBatch = JSON.stringify({
    room: "lobby", count: 2, first_seq: 7, last_seq: 9,
    messages: [
      signedRecord({ seq: 8, room: "lobby", nonce: "12", text: "public two" }),
      { seq: 9, ts: "2026-09-11T10:00:02Z", from: "~nick", text: "public three" }
    ]
  });
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push({ url: url.toString(), method: init.method });
    return new Response(url.pathname.endsWith("/export") ? initialSnapshot : secondBatch, { status: 200 });
  };

  try {
    const first = await watchOnce({ room: "lobby", archivePath, statePath, waitSeconds: 0, fetchImpl, now: () => "2026-09-11T10:01:00Z" });
    const second = await watchOnce({ room: "lobby", archivePath, statePath, waitSeconds: 0, fetchImpl, now: () => "2026-09-11T10:02:00Z" });
    assert.deepEqual(requested, [
      { url: "https://technocore.chat/r/lobby/export", method: undefined },
      { url: "https://technocore.chat/r/lobby?since=8&wait=0&limit=200&format=json", method: undefined }
    ]);
    assert.equal(first.mode, "snapshot");
    assert.equal(first.appended, 2);
    assert.equal(second.appended, 1);
    assert.equal(second.lastSeq, 9);
    assert.equal(first.gapDetected, true);
    assert.equal((await readFile(archivePath, "utf8")).trim().split("\n").length, 3);
    assert.equal(parseJsonl(await readFile(archivePath, "utf8"))[0].nonce, "9223372036854775807");
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).lastSeq, 9);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("watch recovers a tail-window gap from the complete retained export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "technocore-proof-ledger-recovery-"));
  const archivePath = join(directory, "lobby.jsonl");
  const statePath = join(directory, "lobby.state.json");
  const record = (seq) => ({ seq, ts: "2026-09-11T10:00:00Z", from: "~nick", text: `public ${seq}` });
  await writeFile(archivePath, `${JSON.stringify(record(10))}\n`);
  await writeFile(statePath, JSON.stringify({ schemaVersion: 1, baseUrl: "https://technocore.chat", room: "lobby", lastSeq: 10 }));
  const tail = JSON.stringify({ room: "lobby", count: 1, first_seq: 20, last_seq: 20, messages: [record(20)] });
  const retainedExport = Array.from({ length: 10 }, (_, index) => JSON.stringify(record(index + 11))).join("\n");
  const fetchImpl = async (url) => new Response(url.pathname.endsWith("/export") ? retainedExport : tail, { status: 200 });

  try {
    const result = await watchOnce({ room: "lobby", archivePath, statePath, waitSeconds: 0, fetchImpl });
    assert.equal(result.mode, "recovery");
    assert.equal(result.gapDetected, false);
    assert.equal(result.appended, 10);
    const sequences = parseJsonl(await readFile(archivePath, "utf8")).map((item) => item.seq);
    assert.deepEqual(sequences, Array.from({ length: 11 }, (_, index) => index + 10));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("watch stops cleanly when its local controller is aborted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "technocore-proof-ledger-stop-"));
  const controller = new AbortController();
  const fetchImpl = async (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) reject(new Error("aborted"));
    else signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });
  try {
    const running = watchRoom({
      room: "lobby",
      archivePath: join(directory, "lobby.jsonl"),
      statePath: join(directory, "lobby.state.json"),
      fetchImpl,
      signal: controller.signal
    });
    controller.abort();
    assert.equal(await running, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
