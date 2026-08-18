# Tauri Portable Competitor Sales Design

## Goal

Package the competitor sales screen as a Windows portable Tauri application, keep its SQLite cache beside the executable, and add an explicit refresh action that checks only the most recent 14 days.

## Scope

- Include the competitor sales experience at `/competitors`.
- Preserve the existing Next.js/Node contract aggregation and Excel export behavior.
- Do not include the existing 1.1 GB SQLite database in the package.
- Do not add licensing or remote-disable behavior.
- Keep browser development mode working.

## Architecture

Use a small Tauri v2 shell and ship the existing Next.js standalone server as a Node sidecar. This avoids a high-risk Rust rewrite of the contract classification, G2B clients, SQLite cache, and Excel export. The portable folder contains one user-facing EXE plus private runtime files. Tauri starts the sidecar on a loopback-only ephemeral port, waits for health, opens `/competitors`, and terminates the child when the window exits.

The package builder copies only the production Next standalone output, static assets, the Node executable, the `better-sqlite3` native binary, and Tauri runtime files. The database starts empty and is created at `data/g2b-contracts.sqlite`. The local public-data API key is copied into an ignored runtime configuration file during packaging and is never committed.

## Refresh Behavior

The UI adds a `새로고침` button with a refresh icon. A refresh request invalidates cache rows intersecting the trailing 14-day window of the selected period, then reruns the normal SQLite-first aggregation. Standard-contract daily intervals and the current third-party-delivery month are refreshed; older cache remains intact. The response exposes `lastCheckedAt`, displayed separately from `latestContractDate`.

Normal screen entry remains SQLite-first. A complete cache younger than 24 hours returns immediately. An open window does not poll continuously; the user controls external API traffic with the refresh button.

## Portable Layout

```text
나라장터 경쟁사 영업성과\
  나라장터 경쟁사 영업성과.exe
  runtime\
    node.exe
    server\
  data\
    g2b-contracts.sqlite
  config\
    app.env
  logs\
```

Deleting this folder removes the application and its data.

## Error Handling

- Sidecar startup failure is shown in the Tauri window and written to `logs`.
- Refresh failure keeps the previously rendered SQLite result and shows an inline error.
- Partial upstream failure remains explicit; successful source data is not discarded.
- Only `127.0.0.1` is bound and the sidecar receives a per-launch token for local requests.

## Verification

- Existing Vitest suite and TypeScript checking pass.
- New tests cover refresh query construction, 14-day invalidation, last-check display, and refresh failure preservation.
- Rust tests cover portable path resolution and sidecar lifecycle helpers.
- A release package launches on Windows without npm or a global Node installation, responds on the competitor screen, exports Excel, refreshes recent data, exits cleanly, and writes only inside its folder.
