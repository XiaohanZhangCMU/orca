# Orca Manager

A manager delegates to a small team of Orca ICs and publishes a versioned HTML
report inside the workspace. Orca still owns agents, tasks, Dispatches, messages,
and cleanup. This extension owns instructions, launch receipts, and reports.

Create a team with the **Team** button beside the workspace tabs. Choose a manager,
then choose each worker's provider and model independently. The manager's report
opens in Orca's existing HTML preview. The command-line interface remains available.

## Create from the UI

1. Build and start this fork (`pnpm dev` for the source desktop).
2. Open the Git worktree or folder workspace where the team should work.
3. Click **Team**, describe the objective, and configure 1–8 workers.
4. Pick **Codex / OpenAI**, **Claude Code / Anthropic**, **Cursor**, or **OpenCode** per worker.
   Models come from Orca's existing catalog, with **Provider default** and a custom
   model-ID option. Changing a provider resets only that worker's model.
5. Click **Create team**. Follow the report and manager terminal for progress.

Providers must already be installed and authenticated **on the execution host**.
This is not a new API-key/settings store. Account-specific model availability is
not prevalidated. Manager providers are Codex and Claude Code; managers use their
configured default model. Worker provider/model selections are manager instructions,
not a host-enforced allowlist or cost limit.

For **OpenCode**, the model dropdown loads the execution host's `opencode models`
list using Orca's existing model-discovery service. It follows Dreamteam's filter:
`baseten/` and `baseten-<name>/` providers only. Model names are shortened, with the
provider added when names collide; the full model ID is preserved when launching.
Use **Reload OpenCode models** after changing the host's configuration. An empty or
failed lookup never substitutes a laptop list or a static model catalog.

**Provider default** and **Custom model ID…** remain available for other configured
local or hosted models. Enter the full `provider/model` ID shown by `opencode models`
on that host. Listing a model does not verify its credentials or endpoint health,
install it, or enable its provider. See [OpenCode's model configuration](https://opencode.ai/docs/models/).
The filter and label rules match Dreamteam at `2b9a9fa`:
`worker/packages/terminal/src/tmux.ts` (`modelsFor`) and
`ios/Dreamteam/NewSessionView.swift` (`modelPickerNames`). No runtime dependency on
the Dreamteam checkout is added, and no credentials/configuration are copied.
Update both the desktop and paired server to this fork for OpenCode team support.

For a paired CPU pod, select its workspace first and update its server to this fork
(`pnpm build:server`, then restart the server through its existing supervisor).
The UI sends the team to that host, never falls back to the laptop, and explains
when an older server lacks the extension. Direct SSH-only workspaces are refused;
use a paired runtime so orchestration can continue without the laptop.

If a launch loses contact, **Check launch** only reads the saved receipt. Pending
launch IDs and their configuration survive a renderer restart in local storage.
Do not clear them or start a replacement until you have inspected the host's
manager terminal and `launch.json`. A readiness/authentication failure needs manual
attention in that terminal; the extension does not automatically approve prompts.

## Build

From this fork's root, with its dependencies installed and Node 24:

```sh
node extensions/manager/build.mjs
node extensions/manager/dist/orca-manager.cjs --help
```

The result is a self-contained `dist/orca-manager.cjs`. It needs Node, but no
`node_modules`, Electron, or Chromium on the execution host. The build uses Orca's
existing esbuild/Zod dependencies and embeds its design tokens and Geist font.
No new dependencies or lockfile changes are needed. `pnpm build:manager` also builds
the host's portable Orca CLI under `out/manager`; desktop and server builds include
these assets automatically. Packaged desktop assets are unpacked for Node access.

## Start a team

Use an existing workspace registered with Orca. Codex and Claude managers are supported;
install/authenticate the chosen CLIs and enable Orca orchestration first. No
permission-bypass flags are added.

In a terminal **on the execution host**:

```sh
node /absolute/path/to/orca-manager.cjs start \
  --workspace /absolute/path/to/your/workspace \
  --goal "Investigate the failing tests, delegate fixes, verify them, and summarize the result" \
  --workers 3 \
  --manager codex \
  --worker codex
```

These are POSIX continuation examples; use one line on Windows. All executable
calls in the extension use argument arrays and Orca's cross-platform process runner.
The UI supports both Git worktrees and ordinary folder workspaces through the host's
workspace resolver. The standalone launcher uses `worktree show` and needs a workspace
that this upstream CLI can resolve through that command.

If `orca` is not on PATH, add `--orca /absolute/path/to/orca`. A built
`.js`, `.cjs`, or `.mjs` CLI is also accepted and invoked through Node.

For a source-built desktop using the development profile, start that app first
and use `--orca /absolute/path/to/orca/config/scripts/orca-dev.mjs`. The plain
`out/cli/index.js` defaults to the installed app's profile, which may report
`not_running` even while the development app is open. On the pod, use the
pod-local CLI and profile belonging to its `orcad` instead.

The command returns the run directory, manager terminal handle, and report path.
In Orca, open that `report.html` with the existing **HTML preview / Open in Orca
Browser** action. Opening it as source text alone does not render it. Hidden files
may need to be enabled in the file explorer because runs live under `.orca-manager`.

The report shows the manager's summary, task outcomes/evidence, decisions, next
steps, and the ten preceding reports. Full history stays on disk. Refresh pauses
while details are expanded or text is selected; the checkbox disables refresh.
Final reports stop refreshing. Reports are dated assessments, not a live status feed.

`--workers` is a manager instruction limiting concurrent ICs to 1–8; it is **not**
a host-enforced quota or spending limit. Agent subscription/API costs still apply.

## Your CPU pod

Copy the single built bundle onto the pod and run it from an Orca terminal owned
by that pod's local `orcad`. Use the pod-local Orca CLI, not a laptop-selected
`--environment` or a direct-SSH shim back to the laptop. The launcher refuses
remote-selected runtimes and SSH-owned workspaces rather than writing reports on
the wrong filesystem.

Keep the manager, ICs, and orchestration Run on the pod. Your laptop displays the
report through Orca's existing paired-workspace file preview; the pod does not need
Chromium for this. Laptop disconnect does not turn remote work into `exited`.
The pod and its data still need persistent storage/service supervision to survive
pod replacement; this extension does not provision that infrastructure.

## Inspect and steer

```sh
node /path/to/orca-manager.cjs show --run /path/to/run
node /path/to/orca-manager.cjs message --run /path/to/run --text "Keep the API unchanged"
node /path/to/orca-manager.cjs request-stop --run /path/to/run
```

`message` waits for the manager TUI to accept input; it never deliberately sends
user text into an idle shell. `request-stop` is a **graceful request**, not a kill
receipt. Confirm the manager's report and Orca's host-owned Dispatch state. A busy
manager may not reach a safe input point within the timeout; use Orca's terminal
and scoped worker controls when immediate intervention is needed.

For a no-agent preview, use `prepare` instead of `start`, then `launch --run ...`
when ready. Preparation writes files only. It requires a resolvable Orca CLI path,
but does not contact Orca or spend model tokens.

The manager writes `report-draft.json` and publishes it with:

```sh
node /path/to/orca-manager.cjs publish --run /path/to/run --input /path/to/run/report-draft.json
```

The initial draft and generated `manager-prompt.md` document the JSON format.
Reports accept plain text, not arbitrary HTML. Content is validated, bounded, and
escaped; HTML is a controlled template with no external network access.

## Recovery and safety

- `launch.json` is reserved before terminal creation. Repeated launch attempts are
  refused, so a timeout cannot silently create another manager.
- An ambiguous result retains the exact available Orca recovery receipt. Inspect it
  and the recorded terminal. Never delete it merely to retry. No mutation is retried
  automatically, and no unrelated terminal is stopped.
- If first-run authentication/trust prompts block readiness, resolve them in the
  recorded terminal and provide `manager-prompt.md` there manually. The launcher
  does not approve prompts for you or automatically resend uncertain input.
- Messages are refused when runtime/workspace identity changes. Reattach and inspect
  through Orca rather than assuming an old handle names the same process.
- Publication uses an exclusive `publish.lock`, immutable numbered JSON snapshots,
  and atomic HTML replacement. A duplicate publish repairs an interrupted HTML
  update without adding another version. After a process crash leaves a lock, first
  verify that no publisher is running before manually removing that specific lock.
- Reports/prompt files are private to the execution-host user by default. Do not
  include credentials, commit run artifacts, or upload them without explicit intent.

## Keeping the fork small

The coordinator/report implementation stays here. Thin UI/host adapters live in
`src/renderer/src/features/manager-team/` and `src/main/manager-team/`; the schema is
`src/shared/manager-team-contract.ts`. They reuse Orca's workspace routing, process
runner, model catalog, UI primitives, and HTML preview. No scheduler, agent-status
store, orchestration database, or provider authentication code is forked.

Upstream composition edits are limited to the tab-bar mount, RPC registration and
generated params catalog, build/packaging hooks, and a model-catalog registration
for OpenCode's existing `--model` launch flag. The four additive
`managerTeam.*` methods do not change existing RPC payloads or stream opcodes.
Older servers refuse the new methods cleanly; older clients ignore them.

Upstream contract tests assert that the commands/flags/capabilities used here still
exist. They are a useful merge gate, not proof of every runtime behavior. Launch,
remote ownership, retries, and rendered reports have separate tests. Full live-LLM
orchestration and remote reconnect remain deployment smoke tests, not mocked guarantees.

Keep `main` as the upstream mirror and your feature work on `feat/manager-reports`.
After committing or otherwise preserving work, a typical update is:

```sh
git fetch upstream main
git switch main
git merge --ff-only upstream/main
git switch feat/manager-reports
git merge main
```

Run the checks below before publishing an update. No scheduled auto-merge or push is
installed. If upstream changes a CLI contract, update the adapter/prompt here rather
than patching its agent engine.

## Checks

From the repository root:

```sh
node extensions/manager/build.mjs
node node_modules/typescript/bin/tsc --noEmit -p extensions/manager/tsconfig.json
```

From `extensions/manager`:

```sh
ORCA_BACKGROUND_LAUNCH=1 node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
ORCA_BACKGROUND_LAUNCH=1 ORCA_MANAGER_RENDER_TEST=1 node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
```

On Windows, set those environment variables using your shell's normal syntax.
The optional render check uses Playwright CDP and a hidden, isolated Electron
renderer. It never reveals a test window or starts a paid agent.

The host and renderer adapter tests are in Orca's normal suite:

```sh
ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/manager-team src/renderer/src/features/manager-team
pnpm tc
pnpm run check:code-quality:changed
```
