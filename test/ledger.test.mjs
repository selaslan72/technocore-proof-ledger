import test from "node:test";
import assert from "node:assert/strict";
import { makeEvidence, parseJsonl, renderMarkdown, resolveDidFromPermalink } from "../src/ledger.mjs";

const did = "did:key:z6MktestPublicIdentifierOnly";

test("exports only matching signed records with stable permalinks", () => {
  const records = parseJsonl([
    JSON.stringify({ seq: 4, ts: "2026-09-09T00:00:00Z", from: did, nonce: 9, sig: "signature", text: "verified contribution" }),
    JSON.stringify({ seq: 5, ts: "2026-09-09T00:01:00Z", from: "~nick", text: "untrusted" }),
    JSON.stringify({ seq: 6, ts: "2026-09-09T00:02:00Z", from: did, nonce: 10, text: "legacy record" })
  ].join("\n"));
  const evidence = makeEvidence({ baseUrl: "https://technocore.chat", room: "technocore", did, records, fetchedAt: "2026-09-09T00:03:00Z" });
  assert.equal(evidence.recordCount, 2);
  assert.equal(evidence.records[0].permalink, "https://technocore.chat/humans#r/technocore/4");
  assert.equal(evidence.records[0].verification, "signature-present");
  assert.equal(evidence.records[1].verification, "signature-unavailable");
  assert.match(renderMarkdown(evidence), /This report is read-only/);
});

test("rejects malformed JSONL", () => {
  assert.throws(() => parseJsonl('{not json}'), /line 1/);
});

test("resolves a DID only from the exact signed message in a permalink", async () => {
  const fetchImpl = async (url) => {
    assert.equal(url.toString(), "https://technocore.chat/r/technocore?since=41&limit=1&format=json");
    return new Response(JSON.stringify({ messages: [{ seq: 42, from: did, sig: "signature" }] }), { status: 200 });
  };
  const resolved = await resolveDidFromPermalink("https://technocore.chat/humans#r/technocore/42", { fetchImpl });
  assert.deepEqual(resolved, { room: "technocore", seq: 42, did });
});

test("does not resolve an unsigned message from a permalink", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ messages: [{ seq: 42, from: "~nick" }] }), { status: 200 });
  await assert.rejects(
    resolveDidFromPermalink("https://technocore.chat/humans#r/technocore/42", { fetchImpl }),
    /not a signed/
  );
});
