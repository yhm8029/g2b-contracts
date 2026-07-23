# Desktop Portable Launcher Design

## Goal

Create a self-contained `나라장터 경쟁사 영업성과` folder on the Windows desktop. The application, API configuration, SQLite data, cache, dependencies, build output, launch scripts, and logs must all remain under this folder so the user can remove the installation later by stopping it and deleting one folder.

## Folder Layout

```text
Desktop/나라장터 경쟁사 영업성과/
  실행.lnk
  종료.lnk
  app/
  data/
  logs/
  tools/
```

- `app`: exported application source, production build, `node_modules`, and local environment file.
- `data`: `g2b-contracts.sqlite` and its SQLite sidecar files.
- `logs`: standard output and error logs from the local web server.
- `tools`: PowerShell start and stop scripts.
- `실행.lnk`: starts the server when necessary and opens `/competitors` in the default browser.
- `종료.lnk`: stops only the server whose command line points inside this installation folder.

## Installation

Export the current committed branch into `app` without carrying worktree or `.git` metadata. Copy `.env.local` and the existing SQLite database into the portable folder. Install dependencies with `npm ci` and create a production build inside `app`.

The launcher sets `DATABASE_URL` to the top-level `data/g2b-contracts.sqlite`, so runtime data never falls back to another repository path.

## Start Behavior

1. Check whether `http://127.0.0.1:5182/competitors` already responds.
2. If it responds, open the URL without starting another process.
3. If port 5182 is occupied by an unrelated process, show an error and do not stop it.
4. Otherwise start `next start` from `app`, write logs under `logs`, wait for readiness, and open the browser.
5. If startup fails, show a concise error pointing to the log files.

## Stop And Removal

The stop script finds the listener on port 5182 and stops it only when the process ancestry or command line belongs to this portable installation. It must not terminate an unrelated service.

No scheduled task, Windows service, startup entry, global database, or external shortcut is created. After running `종료.lnk`, deleting the desktop folder removes the application and all locally stored data.

## Verification

- Confirm both shortcuts resolve to scripts inside the portable folder.
- Launch from the shortcut and receive HTTP 200 from `/competitors`.
- Confirm the app uses the portable SQLite path.
- Confirm a second launch reuses the running server.
- Stop from the shortcut and confirm port 5182 is no longer listening.
- Start once more and leave the local web available to the user.
