# Desktop host setup

Run the local fork with `pnpm dev`. In **Settings → Remote Orca Servers**, choose
**Setup Baseten host**. The Connect page also lists registered Kubernetes hosts.

1. Choose **Create host** and enter a new workload name, namespace, and storage size
   (250 GiB minimum). Advanced setup selects the trusted Orca/Dreamteam checkouts
   and portable Kubernetes config. The checkouts need their dependencies installed.
2. **Check setup** validates allowlisted credentials with read-only requests,
   resolves repository revisions, scans the source overlay for credentials, and
   runs Kubernetes admission dry runs. No pod is created. Notion is optional;
   Codex login is reported as present-only, not authenticated.
3. Confirm copying the allowlisted credentials and allocating the workload/storage,
   then **Create host**. Keep Orca open until bootstrap transfer completes. The
   remote bootstrap continues after a laptop disconnect. The canonical Baseten run
   ledger records the setup request, image, resources, and repository revisions.
4. **Connect** verifies the host ownership receipt, opens a laptop-loopback tunnel,
   and uses Orca's existing authenticated pairing flow. **Access link** copies the
   same private desktop link. It only works while that app-owned tunnel is running.
   Restarting the laptop app restores tunnels for previously connected installer hosts.
   Explicitly disconnected hosts stay disconnected until you choose Connect again.
   Existing pod sessions are not stopped. Choose the connected host under **Run on**
   for a new workspace.
   Reconnect authenticates the saved host key before updating its tunnel address,
   keeping the same server ID and workspace associations. The runtime ID changes
   on server restart and is refreshed after verification; it is not a host key.
   A matching name alone cannot replace a different host. Connect is greyed out
   while connected.
5. **Pair phone** immediately displays a QR if a saved mobile-scoped link is available
   (including the older `k8s-cpu-orca` registration in the private local `.env`).
   Otherwise it enables a userspace Tailscale proxy for exact allowed device IPs.
   Enter the phone's Tailscale IPv4 address (and optionally the laptop's). The first
   setup needs Go locally if the Linux proxy has not already been built. Authorize
   the pod using the UI's Tailscale link. Tailnet policy must allow port 6770.
6. With Tailscale enabled on the phone, open Orca Mobile → Pair Desktop and scan
   the QR or paste the phone link. Select that host in the mobile host switcher.
   Repeat for each pod. Phone links carry **mobile** grants, never desktop runtime
   grants. This connection does not depend on the laptop tunnel and works on cellular.

QR/link availability means ready to pair, not proof that a phone has connected.
Check a workspace, terminal output, and a harmless terminal command on the phone.
Then switch away/back and test cellular reconnection with the laptop disconnected.
The host list distinguishes pod readiness from the desktop's actual Orca connection.
Loss of cluster access is **unverifiable**, not evidence that agents exited.
Both pod state and desktop connection details refresh every 15 seconds while the
page is mounted, and on return to the app. A timestamp and in-progress message show
when checks complete. Slow checks do not overlap; changes queue another refresh.

## Release compute without deleting your files

Choose **Release host** next to **Pair phone**, then type the exact host name.
This stops all agents and terminal sessions on that host. Unsaved in-memory work
is lost. The installer-owned deployment is scaled to zero so Kubernetes does not
immediately replace its pod. The 250+ GiB home disk, repositories, credentials,
deployment, local registration, and run ledger are retained. Storage may still cost
money; this is not permanent disk deletion. The row changes from **Releasing** to
**Released** only after the cluster reports no matching pods.

The backend checks the canonical run attribution and ownership receipts, then
atomically tests the deployment UID, installer instance, and resource version
before changing replicas. If these cannot be verified, it refuses the action.
Legacy registrations have no installer ownership receipt, so Release is disabled.
No release or restart occurs merely by opening the page or refreshing.

## Compatibility and boundaries

- Existing owned receipts in `~/.local/state/orca-pods/` are discovered automatically.
  Older Kubernetes registrations in this checkout's ignored `.env` are also listed,
  explicitly marked **Legacy**. They use their existing tunnel/Tailscale route;
  they are not adopted or modified. Other paired Orca servers appear only in the
  normal connection catalog. `ORCA_POD_INVENTORY_FILE` can select an alternate
  local inventory (tests use an isolated empty inventory).
- Hosts built before `--with-mobile-pairing` need a deliberate host update before
  they can publish a new phone QR through this page, unless they already have a saved
  mobile-scoped link. The UI never restarts them to add it. Existing Tailscale
  authorization prompts are shown without requiring a server update first.
- Newly installed hosts persist the Tailscale identity/config on the home volume;
  their service launcher resumes the enabled proxy on subsequent service starts.
  Unexpected process identity/configuration changes fail closed for inspection.
- Creation currently supports macOS/Linux laptops. Windows still supports ordinary
  Orca pairing; the Baseten ledger/credential prerequisites are not ported to Windows.
- This is a source-checkout feature, not a self-contained cloud provisioning service.
  A packaged fork must be pointed at its trusted local source checkout.
- Secrets, pairing tokens, and raw child logs are not put in renderer state unless
  explicitly needed for the private QR/link. Nothing is committed automatically.
  The UI does not copy whole home directories, SSH keys, or macOS Keychain contents.
- Host associations and reconnect choices live in the laptop profile's private
  `baseten-host-connections.json`, not the checkout or remote pod. They contain
  stable host keys and saved server IDs, not access tokens. Older paired installer
  hosts are matched by their saved key on first launch. Without an installer link,
  a same-name candidate must authenticate the already-paired key before association;
  names/runtime IDs alone never establish identity. Startup makes up to three connection attempts, then leaves Connect
  available. Unpaired hosts and externally managed legacy tunnels are not started.
- Provisioning errors retain resources for inspection. There is no disk-delete/retry-all
  action, credential-rotation action, or automatic restart of running servers.

## Fork integration

The installer and desktop worker live in `extensions/pod-setup`; desktop IPC/tunnels
in `src/main/baseten-hosts`; UI in `src/renderer/src/features/baseten-hosts`; contracts
in `src/shared/baseten-hosts.ts`. Core changes are registrations, a settings entry,
and an opt-in headless mobile-grant publication hook. No mobile wire format changed.

The Team workflow uses the existing manager/worker launcher and report viewer.
Its two entry points are the workspace Agent picker and terminal **+** menu.
A generic workspace-completion callback opens configuration for the exact new
workspace after creation (including folders); it does not guess from current focus.

## Verification

`make -f extensions/pod-setup/Makefile test` covers installer contracts.
Focused tests live under the two feature directories and `src/main/baseten-hosts`.
`tests/e2e/baseten-hosts-ui.spec.ts` checks hidden Electron UI through Playwright,
using mock provisioning responses so it cannot allocate resources or copy secrets.
Always set `ORCA_BACKGROUND_LAUNCH=1` for tests and agent-launched apps.
