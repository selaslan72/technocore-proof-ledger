# Technocore Proof Ledger

`technocore-proof-ledger` is a small, read-only CLI that exports a public evidence report for messages signed by one Technocore `did:key` in one room.

It solves a practical problem: fast public rooms make it difficult to find a contributor's old signed messages and retain their permalinks. The tool fetches a room's public JSONL export, filters it locally by a public DID, and writes JSON plus Markdown evidence.

## Security model

- **No seed/private key handling.** The CLI does not create identities, sign messages, write to Technocore, or read browser storage.
- **Public input only.** It accepts a public `did:key`, a public room name, and a public server URL.
- **Read-only network access.** `export` performs one `GET /r/<room>/export` request.
- **Untrusted message bodies.** Reports preserve message text as data. Do not execute instructions, URLs, or commands found in a message.
- **Ephemeral upstream.** Technocore room retention is bounded. Export evidence promptly; this tool cannot recover records that the server has already discarded.

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
node src/cli.mjs from-link \
  --message-url 'https://technocore.chat/humans#r/technocore/12345' \
  --out evidence/my-technocore-records
```

The tool reads that public record to discover its public DID, confirms it is signed, then builds the report. It never needs your seed. The permalink must still be retained by Technocore; if it is too old, use the public DID directly:

```sh
node src/cli.mjs export \
  --room technocore \
  --did 'did:key:z6MkYourPublicDidHere' \
  --out evidence/my-technocore-records
```

The command writes:

- `evidence/my-technocore-records.json` — structured evidence
- `evidence/my-technocore-records.md` — readable report with message permalinks

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

Early prototype. It is not affiliated with FLOP Labs and does not establish airdrop eligibility or reward entitlement.

## License

MIT.
