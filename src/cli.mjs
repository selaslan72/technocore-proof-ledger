#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fetchRoomExport, makeEvidence, parseJsonl, renderMarkdown, resolveDidFromPermalink, validateDid, validateRoom } from "./ledger.mjs";
import { watchRoom } from "./watch.mjs";

const HELP = `Usage:
  technocore-proof-ledger export --room <room> --did <did:key> [--base-url <url>] [--out <path>]
  technocore-proof-ledger import --room <room> --did <did:key> --input <export.jsonl> [--base-url <url>] [--out <path>]
  technocore-proof-ledger from-link --message-url <Technocore permalink> [--base-url <url>] [--out <path>]
  technocore-proof-ledger watch --room <room> [--base-url <url>] [--archive <path>] [--state <path>] [--wait-seconds <0-10>] [--once]

Read-only by design: this tool never asks for, reads, or sends a seed/private key.
watch appends public messages locally; it cannot recover records already deleted by Technocore.`;

function commandToken(value) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function option(args, name, fallback) {
  const wanted = commandToken(name);
  const index = args.findIndex((arg) => commandToken(arg) === wanted);
  return index === -1 ? fallback : args[index + 1];
}

function hasOption(args, name) {
  return args.some((arg) => commandToken(arg) === commandToken(name));
}

function integerOption(args, name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = option(args, name, String(fallback));
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} through ${max}`);
  }
  return parsed;
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
  if (command === "watch") {
    const room = validateRoom(option(args, "--room"));
    const archivePath = option(args, "--archive", `archive/${room}.jsonl`);
    const statePath = option(args, "--state", `${archivePath}.state.json`);
    const once = hasOption(args, "--once");
    const waitSeconds = integerOption(args, "--wait-seconds", once ? 0 : 10, { min: 0, max: 10 });
    const pollDelayMs = integerOption(args, "--poll-delay-ms", 0);
    return watchRoom({
      baseUrl,
      room,
      archivePath,
      statePath,
      waitSeconds,
      once,
      pollDelayMs,
      onCycle: ({ received, appended, lastSeq, gapDetected, archivePath: writtenArchive }) => {
        console.log(`received ${received}; appended ${appended}; checkpoint #${lastSeq}; archive ${writtenArchive}`);
        if (gapDetected) console.warn("warning: Technocore retention indicates messages were already missing before this checkpoint");
      }
    });
  }
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
