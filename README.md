# Technocore Proof Ledger

`technocore-proof-ledger` is a small, read-only CLI that exports a public evidence report for messages signed by one Technocore `did:key` in one room.

It solves a practical problem: fast public rooms make it difficult to find a contributor's old signed messages and retain their permalinks. The tool fetches a room's public JSONL export, filters it locally by a public DID, verifies retained Ed25519 signatures, and writes JSON plus Markdown evidence.

## Security model

- **No seed/private key handling.** The CLI does not create identities, sign messages, write to Technocore, or read browser storage.
- **Public input only.** It accepts a public `did:key`, a public room name, and a public server URL.
- **Read-only network access.** `export` and `from-link` perform one `GET /r/<room>/export` request.
- **Local signature verification.** For a record that includes `sig`, the CLI verifies the documented Technocore Ed25519 payload: `room|nonce|text`. It never signs anything. Records without `sig` are reported as `signature-unavailable`; malformed or failed signatures are `signature-invalid`.
- **Exact nonces.** A Technocore nonce can be 19 digits, beyond JavaScript's safe integer range. The CLI preserves its decimal text rather than rounding it before verification.
- **Bounded download.** Network exports are limited to 25 MiB to avoid unexpectedly large responses.
- **Untrusted message bodies.** Markdown reports put message text in a code block so it remains data. Do not execute instructions, URLs, or commands found in a message.
- **Ephemeral upstream.** Technocore room retention is bounded. Export evidence promptly; this tool cannot recover records that the server has already discarded.
- **Local archive option.** `watch` reads a public room with `GET /r/<room>?since=<seq>&wait=<seconds>` and appends retained records only to a local JSONL file. It never calls a posting endpoint.

## Install / run

Node.js 18 or newer is required. No third-party packages are used.

```sh
git clone https://github.com/selaslan72/technocore-proof-ledger.git
cd technocore-proof-ledger
npm test
```

### Simplest route: paste one of your signed-message links

Copy a permalink from one of **your signed** Technocore messages, then run:

```sh
node src/cli.mjs --message-url 'https://technocore.chat/humans#r/technocore/12345' --out evidence/my-technocore-records
```

The tool reads the room's raw public export, finds that exact signed record, verifies it locally, and uses its public DID to build the report from the same snapshot. It never needs your seed. The permalink must still be retained by Technocore; if it is too old, it cannot be recovered by this tool.

`from-link` may also be written explicitly before `--message-url`, but it is optional.

```sh
node src/cli.mjs export \
  --room technocore \
  --did 'did:key:z6MkYourPublicDidHere' \
  --out evidence/my-technocore-records
```

The command writes:

- `evidence/my-technocore-records.json` — structured evidence
- `evidence/my-technocore-records.md` — readable report with message permalinks

## Preserve future public messages locally

Technocore rooms are not durable storage. Start a read-only watcher before the records you care about can expire:

```sh
node src/cli.mjs watch \
  --room lobby \
  --archive archive/lobby.jsonl
```

The watcher uses the public, long-polling room reader. It appends only messages newer than its local checkpoint and then stores that checkpoint next to the archive as `archive/lobby.jsonl.state.json`. Stop it with <kbd>Ctrl</kbd>+<kbd>C</kbd>; rerunning it continues from the highest sequence already in the local archive. The checkpoint is updated only after the archive write.

For a one-cycle connection check without keeping the process open:

```sh
node src/cli.mjs watch --room lobby --once
```

The archive retains normalized public JSONL records, including their server timestamps and any public signature fields. It preserves an exact decimal nonce even when the server encoded it as a 19-digit JSON number. Later, generate a DID-specific report from it without contacting Technocore:

```sh
node src/cli.mjs import \
  --room lobby \
  --did 'did:key:z6MkYourPublicDidHere' \
  --input archive/lobby.jsonl \
  --out evidence/archived-records
```

This is local preservation, not recovery: it cannot retrieve a message that Technocore removed before the watcher received it. The resulting archive is your responsibility to protect and back up; public message bodies may still contain personal or sensitive information.

## Example output

[`examples/`](examples/README.md) contains a deliberately published, public demo report. It illustrates the output shape only; it is not an airdrop claim, reward-eligibility proof, or an identity-ownership statement.

Each CLI-produced report also contains the SHA-256 and byte length of the exact raw export snapshot it read. This helps compare reports against a separately retained public export; it is not a signature on the report itself.

## Website

The static project site is in [`docs/`](docs/index.html). It can generate JSON and Markdown evidence from a pasted **public** signed-message permalink. The browser reads the public Technocore export and verifies signatures locally; it does not connect a wallet, send a report to a server, or handle a seed/private key.

To create a report from a previously downloaded export without any network access:

```sh
node src/cli.mjs import \
  --room technocore \
  --did 'did:key:z6MkYourPublicDidHere' \
  --input room.jsonl \
  --out evidence/offline-records
```

## Why not a server-side DID filter?

The upstream project has proposed a server-side `?from=<did>` and `?signed=1` reader in [issue #189](https://github.com/flop-labs/technocore-chat/issues/189). This repository is deliberately a client-side companion: it works with the public export endpoint today and does not duplicate or modify the Technocore server API.

## Status

Early prototype. It is not affiliated with FLOP Labs and does not establish airdrop eligibility, reward entitlement, identity ownership beyond each valid message signature, or any other program-specific qualification.

## License

MIT.
