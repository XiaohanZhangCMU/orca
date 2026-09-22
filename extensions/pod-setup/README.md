# Non-root Orca host in an existing Linux pod

For a **new Kubernetes pod**, use the [one-command persistent workstation launcher](CLUSTER.md):
`make -f extensions/pod-setup/Makefile dry-run`, then `make -f extensions/pod-setup/Makefile up`.
The remainder of this document describes only the original **existing-pod** installer.

This fork-only extension reproduces the separate non-root host setup. It has no Electron UI,
package-script, or Kubernetes integration hooks to rebase against upstream. It reuses Orca's
runtime client, child-process runner, built server, and daemon rather than implementing another
server protocol.

It does **not** create pods, restart existing servers, move repositories, install an SSH daemon,
or copy account credentials. Run it **inside** a Linux pod; the laptop can use macOS, Linux, or
Windows. It is not a bare-OS provisioner: the prerequisites below must already be available.

## 1. Prepare the source and tools on the pod

Use a checkout of this fork containing `extensions/pod-setup` and the headless-graph startup fix.
Use Node 24, the pnpm version pinned in `package.json`, and a glibc-based Linux x64/arm64 image.
The image needs `bash`, `getent`, `useradd`, `runuser`, and the build dependencies required by
the repository (Python, make, and a C++ compiler if native modules need rebuilding).

Build on the Linux execution host, not on the laptop:

```sh
cd /root/Codes/orca
pnpm install --frozen-lockfile --ignore-scripts
ORCA_BACKGROUND_LAUNCH=1 pnpm build:server
```

Have standalone **Linux native binaries** for Node 24, Claude, and OpenCode available. The setup
copies binaries only, not the original user's configuration or authentication. Symlinks to native
binaries are accepted; npm/shell launch shims are refused. For fresh tool installation, use the
official [Claude installation guide](https://code.claude.com/docs/en/setup) and
[OpenCode installation guide](https://opencode.ai/docs/). Do not copy macOS binaries into a pod.

The source's `node_modules` must include Linux `node-pty` and `@parcel/watcher` plus their native
dependencies. Setup copies the resolved dependency tree into the new installation so it does not
need to traverse `/root` afterward. It never recursively changes ownership of the source checkout.

## 2. Install a separate host

Run as root **inside the new pod**, adjusting the paths to its installed binaries:

```sh
ORCA_SETUP_NODE=/root/.local/share/orca-node24/bin/node \
  bash extensions/pod-setup/setup.sh \
  --source /root/Codes/orca \
  --claude /root/.local/bin/claude \
  --opencode /root/.opencode/bin/opencode \
  --user orca \
  --port 6770 \
  --start
```

`ORCA_SETUP_NODE` selects the Node binary used to build and run the installer; that same binary is
copied into the account unless `--node /absolute/path/to/node24` is supplied.

Add `--dry-run` to validate and print a plan without changing accounts, host files, or processes.
The shell entry still builds its CLI in the checkout's ignored `out/pod-setup` directory. To run a
strictly read-only preflight after that build, invoke `node out/pod-setup/pod-setup.cjs install ...
--dry-run` directly.

Optionally add `--ssh-public-key /tmp/laptop.pub` to authorize **only that public key** for an
already-running SSH daemon. Never supply a private key. Existing authorized keys are preserved.
Without this option, use `kubectl exec` to open a shell; no SSH server or key is required.

Setup creates:

- A locked-password, non-root `orca` account with a private home and no supplementary groups.
- An isolated runtime at `/home/orca/.local/share/orca-pod-host`, with its own Node and native modules.
- `claude`, `opencode`, `ccskip`, `orca-ide`, and `orca-host` under `~/.local/bin`, with login-shell PATH setup.
- A private Orca profile at `/home/orca/.orca` and an empty `/home/orca/Codes/workspace` directory.
- With `--start`, a loopback-only server. No projects, groups, or workspaces are added to its sidebar.

Use **Add Project** in Orca to select the folders or repositories you want on this host. The home
directory and Orca's source checkout are not added automatically. Existing saved projects and
sessions are left untouched; updating the setup script does not remove entries from older hosts.

Identical reruns reuse the managed installation; `start` checks an existing server instead of
restarting it. Different artifacts, occupied ports, unrelated commands, existing unmanaged Orca
profiles, or privileged accounts cause a refusal. This is an installer, **not an updater**. Choose
a separate account/port when another host already exists; do not use it to migrate live sessions.

## 3. Connect from the laptop

Keep this command running in a laptop terminal, replacing the namespace and pod name:

```sh
kubectl --context YOUR_CONTEXT -n YOUR_NAMESPACE \
  port-forward --address 127.0.0.1 pod/YOUR_POD 6770:6770
```

Open a non-root pod shell from another terminal:

```sh
kubectl --context YOUR_CONTEXT -n YOUR_NAMESPACE exec -it YOUR_POD \
  -- runuser --login orca
```

In that shell:

```sh
orca-host status
orca-host pairing
```

Status must show `"ready": true` and `"graph": "ready"`, not merely a reachable socket.
Copy the private pairing link into Orca's **Remote Orca Servers → Connect to a host** dialog.
Under **Advanced**, enable **I am using an SSH tunnel**. Kubernetes port-forward provides the same
loopback forwarding behavior despite that label. The link works only on the laptop running the
tunnel; it cannot be used directly from a phone. Reestablish port-forward if it disconnects.

Pairing a phone to the Mac does not pair it to this pod. In the current build, the Mac's mobile
view excludes mirrored remote-server terminals, even when the pod is selected as **Active Server**.
Mobile access needs a separately authorized private route and pairing to the execution host.
The optional [tailnet proxy](./tailnet-proxy/README.md) provides that route without the Mac.
The base installer does not enable it or Orca Relay. Do not expose the port publicly
or bind Kubernetes forwarding to `0.0.0.0` as a shortcut.

For SSH instead of `kubectl exec`, the pod must already run `sshd`, and setup must have received
your public key. Add `2222:22` to the forwarding command, then use:

```sh
ssh -i /path/to/private-key -p 2222 orca@127.0.0.1
```

Verify the SSH host-key fingerprint against the pod through authenticated Kubernetes access;
never disable host-key checking. A replacement pod can legitimately have a different host key.

## 4. Authenticate and check the agents

Inside the new non-root shell:

```sh
whoami
id -u
claude --version
opencode --version
claude auth login
opencode auth login
opencode models
```

OpenCode lists the models available to **this account's configuration**, not root's. Configure
custom endpoints/models through [OpenCode's configuration](https://opencode.ai/docs/config/).
The Dreamteam dropdown currently filters that catalog to `baseten/` and `baseten-<id>/` model
IDs, matching this fork's Dreamteam model policy. OpenCode's default `opencode/` models alone
will not populate that dropdown: configure the desired Baseten providers under the non-root
account, then click **Reload OpenCode models**. Provider default and custom model IDs remain usable.
Listing a model does not prove that its credentials, billing, endpoint, or model server work.
Keep API keys outside git; this installer deliberately does not migrate them. It does not launch
model-serving jobs or require a GPU on this CPU pod.

Select the new host/workspace in Orca, create a terminal, then reopen the Dreamteam creation
dialog to refresh its OpenCode models. `ccskip` runs Claude without permission prompts as the real
non-root account; it does not bypass Claude's root check. Use it only in trusted workspaces.

## Operations and limits

As the non-root account, `orca-host start` starts or checks the host without changing its project
catalog. The optional `orca-host init-workspace` command explicitly registers a starter folder
under **Non-root workspaces**; installation and startup never call it automatically.
`orca-ide` is the normal Orca CLI bound to this profile.
Readiness and logs live under `~/.local/state/orca-pod-host`; readiness contains pairing credentials
and is never printed by default. `setup.json` records artifact hashes, source location, and UID.

The launcher does not install systemd or a cluster service, and does not expose a public port.
Pod deletion/replacement loses processes and writable-layer data. Put user data on an appropriate
persistent volume or recreate the account and authenticate again. It does not make `/root/Codes`
accessible to the new account: clone needed repositories into `/home/orca/Codes` separately.

Never restart the pod, kill a process group, or remove daemon sockets to repair this host.
For upgrades/restarts, follow [Orca's process-scoped operations guidance](../../docs/reference/orcad-operations.md).
The launcher never automatically breaks a leftover `start.lock`: inspect its owner/process and
the private receipt after an interrupted launch before removing an empty stale lock directory.
Failed installs retain their uniquely named staging directory for inspection; no broad cleanup runs.

## Development checks

From the repository root:

```sh
node extensions/pod-setup/build.mjs
ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config extensions/pod-setup/vitest.config.ts
pnpm exec tsc --noEmit -p extensions/pod-setup/tsconfig.json
pnpm exec oxlint extensions/pod-setup
bash -n extensions/pod-setup/setup.sh
```
