#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchRoomExport, makeEvidence, parseJsonl, renderMarkdown, resolveDidFromPermalink, validateDid, validateRoom } from "./ledger.mjs";

const HELP = `Usage:
  technocore-proof-ledger export --room <room> --did <did:key> [--base-url <url>] [--out <path>]
  technocore-proof-ledger import --room <room> --did <did:key> --input <export.jsonl> [--base-url <url>] [--out <path>]
  technocore-proof-ledger from-link --message-url <Technocore permalink> [--base-url <url>] [--out <path>]

Read-only by design: this tool never asks for, reads, or sends a seed/private key.`;

function commandToken(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function option(args, name, fallback) {
  const wanted = commandToken(name);
  const index = args.findIndex((arg) => commandToken(arg) === wanted);
  return index === -1 ? fallback : args[index + 1];
}

// Chat clients sometimes replace a hyphen with a typographic dash while a
// command is being copied. Accept those variants for command and option names.
function normalizeCliArg(value) {
  return value.replace(/[\u2010-\u2015\u2212]/g, "-");
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
  let [command, ...args] = process.argv.slice(2).map(normalizeCliArg);
  if (commandToken(command) === "fromlink") command = "from-link";
  // The common one-link workflow may omit the command word entirely.
  if (commandToken(command) === "messageurl") {
    args = [command, ...args];
    command = "from-link";
  }
  if (!command || command === "--help" || command === "-h") return console.log(HELP);
  const baseUrl = option(args, "--base-url", "https://technocore.chat");
  let room;
  let did;
  let records;
  let jsonl;
  if (command === "from-link") {
    const messageUrl = option(args, "--message-url");
    if (!messageUrl) throw new Error("--message-url is required with from-link");
    ({ room, did, records, jsonl } = await resolveDidFromPermalink(messageUrl, { baseUrl }));
  } else {
    room = validateRoom(option(args, "--room"));
    did = validateDid(option(args, "--did"));
  }
  const out = option(args, "--out", `evidence/${room}-${did.slice(-8)}`);
  if (command === "export") jsonl = await fetchRoomExport(baseUrl, room);
  else if (command === "import") {
    const input = option(args, "--input");
    if (!input) throw new Error("--input is required with import");
    jsonl = await readFile(input, "utf8");
  } else if (command !== "from-link") throw new Error(`unknown command: ${command}`);
  if (!records) records = parseJsonl(jsonl);
  await writeEvidence(out, makeEvidence({ baseUrl, room, did, records, sourceJsonl: jsonl }));
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
});
