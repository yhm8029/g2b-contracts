# Desktop Portable Launcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a self-contained desktop folder that starts, stops, stores, and removes the local competitor-sales web application as one unit.

**Architecture:** Keep reusable launcher scripts in the repository, then export the committed application into a desktop installation that has no Git/worktree dependency. The launcher injects an absolute SQLite path under the installation root, starts Next.js on port 5182, and writes all runtime artifacts inside the same folder.

**Tech Stack:** PowerShell 5.1, Windows Script Host shortcuts, Node.js/npm, Next.js production server, SQLite.

---

### Task 1: Portable start and stop scripts

**Files:**
- Create: `tools/portable/start-local-web.ps1`
- Create: `tools/portable/stop-local-web.ps1`

- [ ] Create `start-local-web.ps1` that derives the installation root from its own path, sets `DATABASE_URL` to `<root>/data/g2b-contracts.sqlite`, checks `/competitors`, rejects an unrelated listener on port 5182, starts `npx.cmd next start -H 127.0.0.1 -p 5182`, redirects output under `logs`, waits up to 30 seconds, and opens the default browser.
- [ ] Create `stop-local-web.ps1` that inspects the port 5182 process ancestry and stops processes only when a command line contains the installation's `app` path.
- [ ] Parse both scripts with `[System.Management.Automation.Language.Parser]::ParseFile` and require zero syntax errors.
- [ ] Commit the scripts with `git commit -m "feat: add portable local web launcher"`.

### Task 2: Desktop installer

**Files:**
- Create: `scripts/install-portable-desktop.ps1`

- [ ] Create an installer that resolves the Windows desktop, recreates `나라장터 경쟁사 영업성과` only after confirming it is the intended target, and creates `app`, `data`, `logs`, and `tools`.
- [ ] Export tracked `HEAD` files into `app` without `.git` metadata, copy `.env.local` and the existing SQLite database, and copy the portable scripts into `tools`.
- [ ] Run `npm ci` and `npm run build` in the portable `app` directory and stop on nonzero exit codes.
- [ ] Create `실행.lnk` and `종료.lnk` inside the portable root. Each shortcut must invoke Windows PowerShell with `-NoProfile -ExecutionPolicy Bypass -File` and a script path inside `tools`.
- [ ] Parse the installer with the PowerShell parser and commit it with `git commit -m "feat: install portable desktop app"`.

### Task 3: Installation and end-to-end verification

**Files:**
- Create outside Git: `Desktop/나라장터 경쟁사 영업성과/**`

- [ ] Stop the current worktree server on port 5182 after verifying its command line belongs to the current worktree.
- [ ] Run `scripts/install-portable-desktop.ps1` and confirm all expected directories and shortcuts exist.
- [ ] Invoke `실행.lnk`, wait for `http://127.0.0.1:5182/competitors`, and require HTTP 200.
- [ ] Inspect the listener process environment indirectly through SQLite writes and confirm `Desktop/나라장터 경쟁사 영업성과/data/g2b-contracts.sqlite` is used while the worktree database timestamp remains unchanged.
- [ ] Invoke `실행.lnk` again and confirm the same listener PID remains active.
- [ ] Invoke `종료.lnk` and confirm port 5182 closes, then invoke `실행.lnk` and leave the verified server running.
- [ ] Run `git status --short`, push the implementation commits to `origin/feature/g2b-contract-lookup`, and report the desktop folder and local URL.
