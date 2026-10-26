# clidev

**The toolkit for the things CLI coding agents still lack.** Visual clipboard context, lifecycle alerts, hook wiring, safe log sharing and context packing — all local, with agent-specific adapters where they exist.

Built for **[No Hands: The Wispr Challenge](https://www.wemakedevs.org/wispr)** — Builders track. The spec, prompts and docs for this project were dictated, not typed.

```
$ clidev bridge
clidev bridge is running — screenshots will become pasteable @paths

# take a Windows snip, then focus an agent input and press Ctrl+V
clipboard screenshot bridged
  file       C:\Users\you\.clidev\screenshots\shot_20261026-140122.png
  size       1.2 MB
  terminal   @C:\Users\you\.clidev\screenshots\shot_20261026-140122.png
  next       Ctrl+V inside a text-only agent input
```

---

## The CLI agent gaps

| # | Command | What it fixes |
|---|---------|---------------|
| 0 | `clidev hooks --claude` · `clidev inbox` | Your agent finishes or asks for permission while you are in another window. You get a toast, answer by voice in one inbox, and the agent carries on. |
| 1 | `clidev bridge` · `clidev paste` · `clp` | A Windows clipboard companion turns a screenshot into a saved PNG plus terminal-pasteable `@path`; `clp` remains the explicit cross-platform fallback. |
| 2 | `clidev watch` · `clidev notify` | Long agent runs are silent. You come back to a finished build — or find it waiting on a permission prompt. |
| 3 | `clidev hooks --claude` | Lifecycle events differ by agent. Claude Code has supported hooks; other agents use their documented adapters or the portable `watch` fallback. |
| 4 | `clidev clean` | Pasted logs arrive with ANSI garbage, 40 stack frames and a live API key in the middle. |
| 5 | `clidev pack` | Giving an agent context is a manual `@`-file hunt, one path at a time. |

Everything is local. No accounts, no telemetry, no network calls.

### What is universal, and what is an adapter?

`bridge` is an opt-in **Windows preview**. It watches for image clipboard changes, saves a PNG locally, then publishes both the original bitmap and a text reference on the clipboard. Image-aware apps can still choose the bitmap; a text-only terminal pastes the `@path`. It does not inject into an app or pretend every agent understands image paths — test the target agent once.

For the install-once workflow, run `clidev companion install`. It adds one **per-user Windows login** entry that starts the local bridge hidden at sign-in. It does not watch copied text, inject keystrokes into an agent, upload a screenshot, or modify agent configuration. Remove it at any time with `clidev companion uninstall`.

Completion notifications cannot be universally inferred from an interactive agent that stays open. `clidev hooks --claude` handles Claude Code's documented lifecycle events. `clidev watch` is the portable fallback for any finite command, including non-interactive agent runs. Future agent adapters belong behind the same capability model rather than guessed private configuration.

| Capability | Works with any CLI agent | What the agent needs |
|---|---|---|
| Clipboard bridge | Yes, as an `@path` or plain file path | Permission and ability to inspect a local image file |
| `watch` completion alert | Yes, for a command that exits | Launch that command through `clidev watch` |
| Task-finished / input-needed alert | No universal signal exists | A documented hook, plugin or event adapter (Claude Code is included) |
| Cleaned logs / packed context | Yes | Accept pasted text |
| `notify` | Yes | Any supported hook or shell script can call it |

---

## Install

```bash
git clone <this-repo> clidev
cd clidev
npm install
npm run build
npm link          # exposes `clidev` and `clp` globally
```

Requirements: **Node.js ≥ 20.17**. `npm link` is all you need for the hackathon; nothing is published to a registry.

Verify:

```bash
clidev --version
clidev --help
```

### Two binaries, one codebase

| Binary | Entry | Behaviour |
|--------|-------|-----------|
| `clidev` | `dist/index.js` | full command surface |
| `clp` | `dist/clp.js` | paste-first: bare invocation or any flag becomes `clidev paste` |

`clp` gets its own entry file on purpose. npm generates identical shims for both names when two `bin` keys point at the same file — the alias name is never forwarded — so `clp` would be indistinguishable from `clidev` on Windows, macOS and Linux. `src/clp.ts` is a three-line wrapper around the shared `runCli()`.

> **Windows PowerShell note.** PowerShell ships a built-in alias `clp → Clear-ItemProperty` that shadows the npm shim. Use `clp.cmd` there, or free the name once with `Remove-Item Alias:clp`. `cmd.exe`, Windows Terminal (cmd profile) and bash are unaffected.

---

## 0. `clidev inbox` — answer your agents by voice

```bash
clidev hooks --claude     # once: Claude Code now reports to the clidev hub
clidev inbox              # open the inbox (the hub starts by itself)
```

Start Claude Code, hand it a task, and switch to something else. When it needs you:

1. **Claude finishes** → a toast shows what it did. In the inbox, hold your Wispr Flow key, say what to do next, press `Ctrl+Enter`. Claude keeps working with your words as its next instruction.
2. **Claude asks for permission** → the inbox shows the exact command. Press **Allow**, or say *"no, use npm run clean"* and press **Deny**: Claude reads your reason and adjusts.
3. **Claude asks a question** (`AskUserQuestion`) → say the answer and send it.
4. **You'd rather type in the terminal** → **Answer in terminal** / **Leave it stopped** hands control straight back.

The inbox also lists every session (working, waiting, done) and keeps a small record: asks answered, median reply time, words replied.

How it works: the hooks call `clidev relay claude <Event>`, which reports to a local hub on `127.0.0.1:7477` and waits for your reply (up to 15 min after Claude stops, 10 min on a permission prompt). If you don't answer in time, or anything fails, the hook prints nothing and Claude behaves exactly as it would without clidev.

| Claude Code hook | What clidev does |
|---|---|
| `Stop` | waits for your reply, returns `{"decision":"block","reason":"<your words>"}` so Claude continues |
| `PermissionRequest` | waits for Allow / Deny, returns the decision (and your reason) |
| `UserPromptSubmit`, `Notification`, `SessionEnd` | keep the session list current |

```bash
clidev hooks --claude --notify-only   # just a toast, no replies (the old behaviour)
clidev hooks --claude --remove        # undo
clidev hub --stop                     # stop the background hub
```

Privacy: the hub listens on `127.0.0.1` only, every API call needs a random token stored in `~/.clidev/hub/token`, and requests with any other `Host` header are refused, so websites in your browser cannot reach it. Nothing leaves your machine.

Other agents: OpenCode and Antigravity CLI adapters are next; until then use `clidev watch`.

## 1. `clidev bridge` — install-once clipboard companion (Windows preview)

For the no-extra-command workflow, install the companion once after linking:

```bash
clidev companion install
```

At your next Windows sign-in, the local bridge starts hidden. When you take a screenshot or copy an image, it saves a validated PNG and places **both** the original image and a terminal-friendly text reference on the clipboard. Focus a text-only coding agent and press `Ctrl+V` to paste an `@C:\...\shot.png` reference. Stop automatic startup at any time:

```bash
clidev companion status
clidev companion uninstall
```

The bridge never injects keystrokes, reads normal copied text, sends data over the network, or changes an agent's configuration. Image-aware apps may choose the bitmap instead of the text reference. A particular agent must be able to read local image paths for the reference to be useful.

```bash
clidev bridge                    # run visibly in this session
clidev bridge --once             # test the current screenshot once
clidev bridge --format prompt    # paste: Please inspect this screenshot: C:\\...
```

## 2. `clidev paste` / `clp` — explicit, cross-platform fallback

Text-only terminals cannot natively paste a screenshot bitmap. This explicit fallback pulls the image out of the OS clipboard through native APIs, writes a real PNG, and puts a path on your clipboard. Use it on macOS/Linux or whenever you do not want the companion running.

```bash
clp                       # save + copy the absolute path, print it on stdout
clp --at                  # copy @/home/you/.clidev/screenshots/shot_....png
clp --base64              # copy a data:image/png;base64 URL
clp --no-copy             # print only (scripts, tests, CI)
clp --out ./shots         # custom directory
clp --keep 30             # prune everything past the 30 newest captures
clp --json                # { path, bytes, platform, kind, payload, copied }
```

| Platform | Mechanism |
|----------|-----------|
| Windows | `powershell.exe -STA` + `System.Windows.Forms.Clipboard` → `System.Drawing` PNG save; falls back to `GetFileDropList()` for images copied from Explorer |
| macOS | `pngpaste` when installed, else `osascript` writing the pasteboard's `«class PNGf»`, with a TIFF + `sips` conversion fallback |
| Linux | `wl-paste --type image/png` on Wayland, `xclip -selection clipboard -t image/png -o` on X11 |

Every capture is validated against the PNG magic bytes and deleted if empty or corrupt. Old screenshots are pruned by mtime, newest kept.

Failure is explicit, never silent:

```
✖ No image found on the clipboard.
  → Press Win+Shift+S to snip a region — it lands on the clipboard.
  → Copying an image file in Explorer also works (PNG, JPG, BMP, GIF).
  → detail: powershell exited 1
```

---

## 3. `clidev watch` / `clidev notify`

Wrap anything long-running. When it exits you get a native toast, a terminal bell, and a summary with the wall-clock duration.

```bash
clidev watch "npm run build"
clidev watch "claude -p 'fix the failing tests'" --title "Claude Code"
clidev watch "pnpm e2e" --only-fail --sound
clidev watch -- npm test -- --watch=false     # -- protects the child's own flags
clidev watch "docker compose up --build" --json
```

* Exit code is the wrapped command's exit code, so scripts and CI keep working.
* `SIGINT`/`SIGTERM` are forwarded to the child — on POSIX it runs in its own process group so the whole pipeline receives `Ctrl+C`.
* `--only-fail`, `--quiet`, `--sound`, `--no-bell`, `--json`.

```bash
clidev notify --title "Claude Code" --message "Task finished"
```

`notify` is deliberately best-effort: it always rings the bell. On Windows it launches the SnoreToast binary bundled with `node-notifier` directly — node-notifier's own Windows wrapper waits on a named pipe for the toast's entire lifecycle (~10s), which would blow a 10s Claude hook timeout, while the binary starts in ~150ms. macOS and Linux use `node-notifier`, with `osascript` / `notify-send` fallbacks. It never exits non-zero, because a blocked toast must not break a pipeline.

---

## 4. `clidev hooks`

Writes Claude Code lifecycle hooks for you — atomically, idempotently, and with a backup.

```bash
clidev hooks --claude              # reply mode: every event -> clidev relay -> inbox (see section 0)
clidev hooks --claude --notify-only  # Stop + Notification -> clidev notify (shape shown below)
clidev hooks --claude --dry-run    # print the resulting JSON, write nothing
clidev hooks --claude --remove     # strip our hooks, keep everything else
clidev hooks                        # guides for Antigravity, OpenCode, Aider, aliases
```

Safety properties:

* reads `$CLAUDE_CONFIG_DIR/settings.json` when set, otherwise `~/.claude/settings.json`;
* refuses to touch a file that is not valid JSON;
* writes `settings.json.tmp-<pid>` then renames — a crash cannot truncate your config;
* copies `settings.json.bak-<timestamp>` before changing anything (`--no-backup` opts out);
* re-running updates the existing entry instead of appending duplicates;
* unrelated settings, matchers and other hooks survive untouched;
* falls back to `node "<abs>/dist/index.js"` when `clidev` is not on `PATH`, so hooks keep working.

Resulting shape with `--notify-only`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "clidev notify --title \"Claude Code\" --message \"Task finished\"",
            "timeout": 10
          }
        ]
      }
    ],
    "Notification": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "clidev notify --title \"Claude Code\" --message \"Waiting for your input\"",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Other agents get `clidev watch` guidance rather than a guessed private config schema:

```
Antigravity CLI   clidev watch "agy --print 'fix the failing tests'" --title Antigravity
OpenCode          clidev watch "opencode" --title OpenCode
Aider             clidev watch "aider --message 'refactor auth'" --title Aider
Shell alias       alias cc='clidev watch "claude" --title "Claude Code"'
```

---

## 5. `clidev clean`

A pipe filter for logs you are about to paste into an agent.

```bash
npm run build 2>&1 | clidev clean
cat dev-server.log | clidev clean --json | jq .stats
clidev clean --file crash.log --keep-frames
```

What it does, in order:

1. **ANSI** — strips CSI colours/cursor movement, OSC window titles, OSC 8 hyperlinks and DCS payloads; normalises `\r` progress spinners to their final frame; drops stray control characters.
2. **Secrets** — masks OpenAI (`sk-`, `sk-proj-`), Anthropic (`sk-ant-`), GitHub (`ghp_`, `github_pat_`), GitLab, Slack, AWS (`AKIA`/`ASIA`), Google (`AIza`), Stripe live keys, HuggingFace tokens, JWTs, `Bearer` tokens, PEM private-key blocks, `user:pass@` URLs and `*SECRET*|*TOKEN*|*PASSWORD*|*API_KEY*=value` pairs with `[REDACTED_SECRET]`.
3. **Noise** — hides runs of `node_modules` / `node:internal` stack frames behind one line, folds lines repeated three or more times, squashes blank-line runs.

The cleaned text goes to **stdout** and to your **clipboard**; the receipt goes to stderr:

```
clean complete
  size       18,204 → 2,931 chars
  saved      15,273 chars (84%) · ~3,818 tokens
  ansi       412 escape sequences stripped
  secrets    3 redacted
  noise      37 stack frames · 12 repeats collapsed
  clipboard  cleaned text copied
```

Masking is idempotent, so running `clean` twice never double-redacts. `--keep-frames` and `--keep-duplicates` opt out of the folding.

---

## 6. `clidev pack`

Turns a set of files into one markdown block with a directory tree, language-tagged fences and a token estimate — then puts it on the clipboard.

```bash
clidev pack                            # git-changed files, else src/**/*
clidev pack "src/**/*.ts" --print
clidev pack src/cli.ts README.md
clidev pack --all --max-tokens 60000
clidev pack "src/**/*" --out .context.md
```

Guards that keep the bundle useful:

* `node_modules`, `.git`, `dist`, `build`, `.next`, caches, lockfiles, sourcemaps and minified bundles are ignored;
* binary extensions are skipped, and any file with NUL bytes in its first 8 KB is treated as binary;
* per-file ceiling (`--max-bytes`, default 100 KB) and a budget ceiling (`--max-tokens`, default 150,000) — files that would blow the budget are reported, not silently cut in half;
* fences grow longer when a file already contains backticks, so markdown files cannot break the bundle;
* token estimate is `ceil(characters / 4)`, stated up front so you know what you are feeding the model.

Output shape:

````markdown
# Project context

> clidev pack · git-changed · 12 files · 1,842 lines · ~14,206 tokens
> Generated 2026-10-26T14:01:22.000Z

## Tree

```text
src
├── commands
│   ├── clean.ts
│   └── paste.ts
└── cli.ts
```

---

## src/cli.ts

```ts
...
```
````

---

## Landing page

`web/index.html` is a single self-contained file — inline CSS and JS, no build step, no CDN at runtime except the Google Fonts link (system fallbacks when offline). Open it directly or serve the folder:

```bash
npx serve web
```

It contains an interactive terminal simulator: click `clp`, `clidev watch`, `clidev hooks --claude`, `clidev clean` or `clidev pack` and watch the real output strings animate in.

---

## Architecture

```
src/
├── index.ts              clidev entry — full command surface
├── clp.ts                clp entry — defaults to `paste`
├── cli.ts                commander program, argv aliasing, EPIPE-safe errors
├── version.ts            version injected by tsup `define`
├── adapters/
│   └── claude.ts         Claude Code hook payload <-> hub event / reply JSON
├── hub/
│   ├── protocol.ts       event, ask, reply and stats types shared by every adapter
│   ├── store.ts          pure session + ask state, waiters, history
│   ├── server.ts         127.0.0.1 HTTP hub: token, Host check, long-poll waits, toasts
│   ├── inbox-page.ts     the self-contained inbox page
│   └── client.ts         find or auto-start the hub, report, wait for a reply
├── commands/
│   ├── hub.ts            `clidev hub` and `clidev inbox`
│   ├── relay.ts          hook entry point: stdin payload -> hub -> stdout reply
│   ├── bridge.ts         Windows clipboard bitmap + text-reference companion
│   ├── companion.ts      opt-in per-user Windows login startup installer
│   ├── paste.ts          clipboard image -> PNG -> path on clipboard
│   ├── watch.ts          spawn + duration + notify + signal forwarding
│   ├── notify.ts         toast + bell, best effort
│   ├── hooks.ts          atomic Claude settings installer
│   ├── clean.ts          stdin/file pipe filter
│   └── pack.ts           discovery, guards, markdown bundle
└── utils/
    ├── clipboard-img.ts  Windows / macOS / Linux image extraction
    ├── clipboard.ts      clipboardy text wrappers
    ├── notifier.ts       SnoreToast / node-notifier fallback chain
    ├── sanitize.ts       pure: ANSI, secrets, stack + repeat folding
    ├── pack-format.ts    pure: tree, fences, token estimate
    ├── claude-hooks.ts   pure: merge / remove hook entries
    ├── paths.ts          ~/.clidev, screenshot naming, collision safety
    ├── shell.ts          cached which/where, CLI invocation resolution
    ├── logger.ts         stderr decoration, banner, boxes, spinners
    └── format.ts         bytes, durations, counts, token math
```

Pure logic lives in `utils/` so it can be tested without a clipboard, a desktop session or a real home directory.

---

## Design decisions worth defending

**stdout is a contract.** Payload (path, cleaned log, markdown bundle) goes to stdout; every box, spinner and statistic goes to stderr. That is what makes `clidev paste | pbcopy`, `clidev clean > build.log` and `clidev pack --print > ctx.md` behave.

**Notifications must never fail the job — or stall it.** node-notifier's Windows toaster blocks on a named pipe until the toast times out (~10s), which is fatal inside a hook with a 10s budget. clidev starts the bundled SnoreToast binary detached instead (~150ms), keeps node-notifier for macOS/Linux, and falls back to PowerShell / `osascript` / `notify-send`. It always rings the bell and exits 0 even if the OS blocks the toast.

**Config edits are atomic.** `hooks` backs up, writes a temp file, then renames. A killed process leaves either the old file or the new one — never half of each.

**Dependencies stay external in the bundle.** `node-notifier` ships `snoretoast` / `terminal-notifier` binaries that cannot be inlined into JS. tsup bundles our source with a shebang banner and leaves runtime packages resolvable.

**No native clipboard module.** Screenshot extraction uses OS tooling that already exists (PowerShell + .NET, `pngpaste`/`osascript`, `wl-paste`/`xclip`). Nothing to compile, nothing to break on a judge's laptop.

---

## Platform support

| Capability | Windows | macOS | Linux (Wayland) | Linux (X11) |
|-----------|---------|-------|-----------------|-------------|
| `paste` | PowerShell STA + .NET, file-drop fallback | pngpaste / osascript / sips | `wl-paste` | `xclip` |
| `notify` | SnoreToast (detached) → PowerShell toast | node-notifier → osascript | node-notifier → notify-send | notify-send |
| `hooks` | yes | yes | yes | yes |
| `clean` | yes | yes | yes | yes |
| `pack` | yes | yes | yes | yes |

Windows is the reference implementation and the only one exercised end-to-end here. The macOS and Linux paths are written against documented OS behaviour and fail loudly with install hints instead of pretending to succeed.

---

## Privacy

* No network calls, no analytics, no accounts.
* Screenshots stay in `~/.clidev/screenshots/` (override with `--out` or `CLIDEV_HOME`).
* `clean` redacts locally; nothing is uploaded to verify a key.
* `hooks` touches exactly one file, with a backup.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev -- <cmd>` | run the CLI from TypeScript via tsx |
| `npm run build` | bundle `dist/index.js` + `dist/clp.js` |
| `npm run typecheck` | `tsc --noEmit` under NodeNext strict mode |
| `npm test` | Node test runner + tsx (`src/**/*.test.ts`) |
| `npm run check` | typecheck, tests, build in that order |
| `npm run link` / `npm run unlink` | manage the global binaries |

---

## Limitations

* `paste` needs an actual clipboard session; headless CI has none and will get a clear error.
* macOS may ask for Automation permission the first time `osascript` reads the pasteboard; `brew install pngpaste` avoids that prompt.
* Windows Focus Assist can suppress toasts; the bell and exit code still work.
* `pack` does not parse `.gitignore` itself — the default ignore list is explicit and conservative.
* The npm name `clidev` may already be taken; `npm link` from this folder does not care.
* Windows PowerShell reserves `clp` for `Clear-ItemProperty`; call `clp.cmd` or run `Remove-Item Alias:clp` once.
* The first Windows toast may create a SnoreToast shortcut in the Start Menu — that is how the Windows toast API registers an app id.

---

## License

MIT.
