#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchRoomExport, makeEvidence, parseJsonl, renderMarkdown, validateDid, validateRoom } from "./ledger.mjs";

const HELP = `Usage:
  technocore-proof-ledger export --room <room> --did <did:key> [--base-url <url>] [--out <path>]
  technocore-proof-ledger import --room <room> --did <did:key> --input <export.jsonl> [--base-url <url>] [--out <path>]

Read-only by design: this tool never asks for, reads, or sends a seed/private key.`;

function option(args, name, fallback) {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

async function writeEvidence(out, evidence) {
  const jsonPath = resolve(out.endsWith(".json") ? out : `${out}.json`);
  const markdownPath = jsonPath.replace(/\.json$/, ".md");
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(markdownPath, renderMarkdown(evidence));
  console.log(`wrote ${jsonPath}`);
  console.log(`wrote ${markdownPath}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") return console.log(HELP);
  const room = validateRoom(option(args, "--room"));
  const did = validateDid(option(args, "--did"));
  const baseUrl = option(args, "--base-url", "https://technocore.chat");
  const out = option(args, "--out", `evidence/${room}-${did.slice(-8)}`);
  let jsonl;
  if (command === "export") jsonl = await fetchRoomExport(baseUrl, room);
  else if (command === "import") {
    const input = option(args, "--input");
    if (!input) throw new Error("--input is required with import");
    jsonl = await readFile(input, "utf8");
  } else throw new Error(`unknown command: ${command}`);
  await writeEvidence(out, makeEvidence({ baseUrl, room, did, records: parseJsonl(jsonl) }));
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
