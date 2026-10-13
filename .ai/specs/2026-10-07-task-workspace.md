# Task workspace — terminal (extract for main)

> Status: §6 (the terminal) ported to main on 2026-10-13 from `origin/brutus`, where the full
> task-workspace specification lives (layout cards, columns, browser preview — §§1-5, 7-13). Only
> the sections main's code cites are kept here, under their original numbers, so citations stay
> valid; when the rest of the workspace lands, brutus's full document replaces this file.
>
> Implementation on main: `packages/cezar/src/server/terminal/` and the `/runs/:id/terminal`
> family in `packages/cezar/src/server/server.ts`; cockpit in `packages/web/src/routes/task-workspace/`.
>
> **Main deviations from §6 as written:**
> - There is no workspace layout on main, so the drawer is mounted as a **Terminal tab** of the
>   task view (`/tasks/:id/terminal`, `task-terminal.tsx`). Shells are server-owned and keep
>   running across tab switches; "Open in Browser" on a detected address opens a browser tab.
> - `CEZ_TERMINAL` unset follows `localHandoff` (on locally, off hosted). Brutus also allows a
>   hosted cockpit that enforces its own sign-in; main has no sign-in, so that case does not exist.
> - New shells do not receive the per-task slot environment (`taskSlotEnv`), a separate brutus feature.

## 3. Product principles and constraints

1. **Cezar first.** Reuse current task components and UI primitives. Add the smallest visual layer
   needed to support multiple views. Do not recreate the app shell or make a parallel design system.
2. **The current task stays the task.** `/tasks/:id` remains the canonical task URL. It opens the
   workspace with Conversation selected initially. Existing `/changes`, `/files` and `/commits`
   paths remain valid and deep-linkable.
3. **One worktree.** Every panel in a workspace belongs to the same run and its worktree. Panels
   must not silently display the boot repo or a different task's state.
4. **Observe safely.** A task may be running while the user reads its transcript, diff or files.
   Workspace navigation and resizing must not send messages or mutate task state.
5. **Explicit actions.** Starting a terminal or preview process is an explicit user action unless a
   later approved spec establishes a safe, predictable auto-start rule.
6. **Human review gate remains.** No panel auto-commits, pushes, creates a PR, merges, or accepts an
   agent's result merely because it was opened.
7. **Zero-config default.** Discover what can be discovered; missing project scripts, binaries,
   permissions or worktrees produce useful empty states rather than mandatory setup.
8. **Remote/local ownership stays honest.** Files, processes and preview ports belong to the host
   running the task, not to the browser client.


## 6. Terminal feature (implemented, Milestone 2)

> **IMPLEMENTATION NOTE — the PTY is an optional dependency.** `@lydell/node-pty`, declared in
> `optionalDependencies`. cezar ships zero native dependencies and zero install scripts, and its
> self-update path runs `npm install` on the user's machine WITHOUT `--ignore-scripts`
> (`src/self-update/installer.ts`), so upstream `node-pty` — whose install script is
> `node scripts/prebuild.js || node-gyp rebuild` — would compile there, on whatever Node they
> have, across four platforms, and a failure would break the whole cockpit rather than one panel.
> The fork declares no install script and ships prebuilt binaries for linux/win32/darwin on
> x64+arm64. A platform with no binary reports the terminal unavailable WITH A REASON and cezar
> boots normally.
>
> **IMPLEMENTATION NOTE — `CEZ_TERMINAL` is a tri-state.** Unset it follows the deployment mode:
> on locally, off on a hosted cockpit, the same line `localHandoff` draws for every other
> host-machine affordance. `=1` opts a hosted cockpit in; `=0` turns it off everywhere. Hosted is
> opt-in because cezar has no authentication of its own, so a shell there is handed to whoever the
> reverse proxy admits — AGENTS.md's rule for a feature that widens exposure. Documented in
> `.env.example` and `docs/reference.md`.
>
> **IMPLEMENTATION NOTE — tab names come from the process table, not from what was typed.**
> `server/terminal/foreground.ts` reads a shell's live child. Typing is the wrong source: it
> misses anything a script, a key binding or a shell rewrite started, and it would have to
> re-implement line editing to know when a line was submitted. The same reading answers "is
> something running", so a tab's name and the warning for closing it cannot disagree.
>
> **IMPLEMENTATION NOTE — "Stop" interrupts; the tab's X closes.** §11 reads as though Stop should
> also close the tab. It does not: stopping a command is not the same as closing a terminal, and
> you stop a build precisely so you can read why it was wrong. Stop sends Ctrl-C; closing a tab
> with something running asks first and then takes the whole process tree.
>
> **IMPLEMENTATION NOTE — the size handshake has to be armed before the first fit.** This section
> asks for resize propagation, and the obvious shape of it is wrong in a way that is invisible
> until you look at the server: the emulator is constructed at xterm's default 80x24, and the
> OPENING fit is the one that takes it to whatever the drawer actually measures. An `onResize`
> listener attached after that fit never hears the only event that matters, and nothing fires
> again afterwards — the ResizeObserver re-fits only when the HOST changes size, and a fit that
> computes the same dimensions emits no event. The shell is then left believing it has 80 columns
> while the user looks at ~120, so zsh wraps early and anything full-screen draws wrongly. The
> listener is therefore registered BEFORE the first fit, and the fitted size is sent once
> unconditionally, which also covers the mirror case of a drawer that really does measure 80x24.
> Observed live on 2026-10-08 (a fresh session reported 113x15 instead of 80x24) and pinned in
> `terminal-pane.test.tsx`, which fails against the previous ordering.
>
> **IMPLEMENTATION NOTE — output never rides the WebSocket.** The per-session topic publishes a
> cursor and nothing else; the bytes come back over the same authenticated HTTP as the rest of the
> cockpit. The hub's topics are workspace-level and readable by anything its upgrade guard trusts,
> which is the last place terminal content belongs. Browsers also send no `Sec-Fetch-*` headers on
> a WebSocket handshake, so a connection that is not provably same-authority (a dev proxy, and
> Safari and Firefox generally) is admitted untrusted and refused the topic — the view falls back
> to polling, which costs latency and nothing else.

Terminal is not just a panel around `openRunInCli`; it needs an interactive PTY transport and
lifecycle. A future terminal spec must resolve:

- PTY implementation/dependency and supported OSes.
- A Cezar server restart stops all terminal sessions and child processes; the user starts them again manually after Cezar returns. Archiving a task also stops its terminal sessions and Cezar-started apps, while preserving layouts and Browser tabs. Permanently deleting a task removes its layouts and task-owned state.
- Multiple terminal tabs, shell selection, resize propagation, scrollback cap and copy/paste.

  > **IMPLEMENTATION NOTE (2026-10-08) — shell selection is an ALLOWLIST, discovered.** The `+`
  > asks which shell when the host offers more than one, and the list comes from the host:
  > `/etc/shells` narrowed to entries that exist, with `$SHELL` and the platform default folded
  > in (Windows has no such file, so there it is the known interpreters that are present). A
  > request may only name something already on that list; anything else is refused rather than
  > spawned.
  >
  > It is tempting to argue the allowlist adds nothing, since a terminal already runs arbitrary
  > commands inside a shell. It does: the executable a request SPAWNS is the one thing the
  > worktree discipline never covers, so taking it from the body verbatim would turn
  > `POST /terminal` into "run this binary on the host", reachable by anything the reverse proxy
  > admits — and §6 already records that a hosted cockpit has no authentication of its own.
  >
  > A host that can enumerate nothing still opens its default, and a cockpit talking to an older
  > server that sends no list simply does not offer the choice.
- Which process tree is killed on stop and how shutdown/reclaimed worktrees are handled.
- How the API authenticates/authorizes terminal input for local and remote modes. Follow the
  versioned API contract, route chaining, validation and remote credential boundaries in AGENTS.md.
- Whether a PTY uses an authenticated WebSocket or another transport. Do not add a new global
  WebSocket topic unless its demand lifetime and workspace-level data safety match the existing
  topic rules.
- The bottom drawer starts hidden on a fresh task visit and is shown only after an explicit user action. After unarchiving, it is hidden and has no tabs; opening it later creates a new session. A page refresh restores whether it was open or closed. Opening a hidden drawer with existing tabs reconnects them; if it has no tabs, create a fresh terminal session. Its top edge can be dragged to change drawer height; save the preferred height per task and restore it when the task is reopened. It can contain several terminal tabs, like VS Code. Add a tab with a `+` button or a keyboard shortcut. A new tab starts as `Terminal 1`, `Terminal 2`, etc.; while a command runs, show that command as the tab name, and keep that name when it finishes until another command runs. Each tab is a separate PTY session in this task's worktree. The user can open and close terminal tabs independently using an X button or tab menu. Before closing a tab with a running process, show a warning with `Zamknij mimo to` and `Anuluj`. Confirming closes the terminal session and stops its process tree; canceling leaves it running. Closing the last terminal tab hides the drawer.
- Terminal tabs belong to the task, not to a saved layout. Switching between saved layouts keeps
  the same terminal sessions available. Switching to another task hides this task's terminal but leaves its processes running. Returning to the task keeps it hidden with the same sessions. Refreshing or reconnecting the browser preserves processes, reattaches the tabs, and restores the
  drawer's previous open/closed state. A Cezar server restart stops terminal sessions and child processes and removes the old terminal tabs;
  the user starts commands again in fresh tabs after Cezar returns. Archiving a task stops terminal
  sessions and Cezar-started apps, removes terminal tabs, and preserves layouts (including Browser
  tabs) for unarchive. Deleting a task also removes its layouts and task-owned state.
- Terminal input executes arbitrary shell commands on the cezar host. It must be explicitly
  user-initiated and clearly identify host, project and worktree.

