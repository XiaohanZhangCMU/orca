# One-command CPU workstation

This fork-only launcher extends the existing non-root installer. It creates a **new** Kubernetes
Deployment with a **250Gi persistent home**, clones Dreamteam's seven configured repositories plus
this Orca fork, and builds and starts Orca on Linux. Cloning does not add projects to the sidebar;
only add the repositories or folders you want through Orca's **Add Project** UI.
The old pod, its sessions, and its files are not modified or migrated.

From the Orca checkout on your laptop:

```sh
make -f extensions/pod-setup/Makefile dry-run
RUN_PROMPT='Create my persistent non-root Orca workstation; Notion may remain pending.' \
  make -f extensions/pod-setup/Makefile up
make -f extensions/pod-setup/Makefile status
make -f extensions/pod-setup/Makefile verify
make -f extensions/pod-setup/Makefile shell
```

Requires installed Orca development dependencies, kubectl access, and Dreamteam's `.venv` with
boto3 for the laptop storage checks. On Windows, use a Bash/Make environment with Node, Git,
kubectl and the Dreamteam Python environment available. The workload itself is Linux amd64.
`make -C extensions/pod-setup up` is equivalent. Set `CONFIG=/absolute/path/to/config.json` for a
different configuration. The example config allows **only Notion** to be missing.

## What the dry run proves

Read-only authenticated requests check GitHub and repository access, Linear, Notion, HF, W&B,
Tinker, Baseten management and inference catalogs, Rancher, Anthropic, OpenAI, AWS STS, and both
Dreamteam Wasabi buckets. Kubernetes validates the exact PVC/Deployment with server-side dry run.
No model inference, training, uploads, test issues, Git pushes, or Notion writes are performed.
This confirms read access, **not every write permission**. Codex login-file presence/expiry is
advisory: it is not refreshed or tested with a paid request.

The dry run builds ignored local CLI artifacts and makes read-only network requests. It creates
no Kubernetes resources and copies no secrets. `up` repeats checks before creation; once booted,
the pod repeats authentication checks and verifies CLI versions, Kubernetes access, OpenCode
models, and actual Orca runtime readiness.

## Credentials and source

Only the allowlisted service files in `src/cluster-credentials.ts` are copied. The launcher reads
the selected keys from Dreamteam's `.env`, the laptop environment, and standard home paths.
It includes token-auth kubeconfigs, `.trussrc`, Wasabi/AWS, Linear/Tinker/Baseten keys, and the
portable Codex login used by Dreamteam. It does not copy your whole `.config`, macOS Keychain,
SSH private keys, browsers, or unrelated messaging credentials. It does not sync back to Wasabi.
Missing credentials block setup unless explicitly named in `allowUnverified`.

Secrets travel through encrypted Kubernetes exec **stdin**, not command arguments, Kubernetes
manifests, ConfigMaps, or the run ledger. They are stored under the private non-root home with
mode 0600 (directories 0700), and loaded by shells and the Orca server. Existing different files
are preserved, not replaced. Agents running under this account can access these credentials;
this is a trusted personal workstation, not per-agent credential isolation.

The management `BASETEN_API_KEY` and inference `BASETEN_INFERENCE_API_KEY` stay separate. OpenCode
uses Dreamteam's provider/model configuration with the inference environment reference. HF's
multiline local credential source is normalized to the single token that passed verification.

Each repository is fetched at a resolved commit with a credential-free HTTPS remote and checked
out on a local branch named `pod-bootstrap`. For ordinary repositories, that commit is the remote
default branch's HEAD when setup is planned; the installer adds no commits. The branch is a pinned
starting point, not a feature branch or an automatically updated copy of `main`.

Orca uses the local checkout's HEAD plus a SHA256-recorded working-tree overlay, including
uncommitted fork changes. These changes remain uncommitted on the pod. The base commit must be
available from the fork. Existing repositories are never pulled, reset, or overwritten. The script
is an installer, not an updater or secret-rotation tool.

## Persistence and non-root execution

The default volume uses `storageclass-wekafs-fs-api` in `ori-rcano-testing`; edit the config for
another cluster. CPU requests are 2 cores/8Gi RAM, limits 16 cores/96Gi RAM; no GPUs are requested.
A short root init container initializes only this new volume's ownership and account files.
The application, setup, terminals, Claude/`ccskip`, and agents run as UID/GID 1001, without sudo,
privilege escalation, added capabilities, or a mounted service-account token.

Repositories, credentials, tools, and the Orca profile live on the PVC. A pod replacement keeps
those files but **cannot keep running processes alive**. A container supervisor starts the installed
Orca host on boot. The PVC is not automatically deleted. Deleting the PVC can destroy its data;
this launcher deliberately has no destructive `down` command.

`up` stores an ownership receipt under `~/.local/state/orca-pods/<name>/`. Reruns require matching
resource UIDs and configuration; an unrelated object with the same name is refused. Bootstrap
runs detached inside the pod and survives laptop disconnection. `status` reports its last recorded
phase, not a guarantee that a process is still live. If interrupted, inspect status before retrying.

Every deployment is recorded through Dreamteam's canonical `record_run.sh`, including the driving
prompt, image digest, hardware/storage, source pins and overlay, and launcher bundles. Actual pod
pins are listed separately from the ledger's local trainers/loops reference snapshots.

## Connect Orca

In one laptop terminal:

```sh
make -f extensions/pod-setup/Makefile connect
```

In another, get the private access link:

```sh
make -f extensions/pod-setup/Makefile pairing
```

Add it in Orca's Remote Servers UI and enable the Advanced tunnel option because this connection
uses `127.0.0.1:6771` on the laptop (forwarded to 6770 on the pod). This leaves the old host's
6770 tunnel untouched. In **Add Project**, choose the new host and a cloned repository such as
`/home/orca/Codes/trainers`. No starter groups, home folders, or cloned repositories are registered
automatically, including the Orca source checkout used to build the server. Startup preserves any
projects and sessions already saved on an older host; it does not clean up existing sidebar entries.
Set the same `LOCAL_PORT=6772` on both `connect` and `pairing` if 6771 is busy.
The pairing command uses Orca's existing codec to change only the loopback port, preserving the
host key and credential; it does not change the server, credential scope, or wire protocol.

No SSH daemon or public ingress is installed. `shell` opens a non-root Kubernetes exec shell.
This fresh host does not reuse the old pod's Tailscale identity or phone pairing. Direct phone
access needs a separately authorized Tailnet connection; see [tailnet-proxy](tailnet-proxy/README.md).

Private diagnostics are in `/home/orca/.local/state/orca-cluster/`; do not paste raw logs or
credential files into issues. `make ... test` runs local typechecks and isolated extension tests.

## Private laptop inventory

After the pod is ready, save its commands and private desktop link locally:

```sh
make -f extensions/pod-setup/Makefile export-env CONFIG=extensions/pod-setup/cluster.example.json LOCAL_PORT=6771
```

Use your own config and matching local tunnel port. This updates one named block in the Orca
checkout's `.env`, preserving existing settings and other pod entries. It refuses a tracked or
non-ignored `.env`, links, and ambiguous block markers. On macOS/Linux the file is mode 0600;
on Windows also restrict its ACL to your account. Read it as dotenv data, not as a shell script.

Each `ORCA_POD_<NAME>_*` block contains deployment/pod/PVC identity, image/source provenance,
non-root exec command, setup/verification commands, tunnel endpoint and private pairing link,
plus separate laptop/phone instructions. A saved pairing link is a credential. Do not commit,
upload, paste it into issues, or copy this inventory onto the pod. The source-overlay uploader
excludes `.env`; these inventory keys do not change Orca's active host automatically.

Phone readiness is separate from desktop readiness. A loopback laptop link cannot
work on a phone. A new pod needs its own authorized Tailscale identity, the phone IP in the proxy
allowlist, and a mobile-scoped Orca grant advertising that pod's Tailscale endpoint. Never copy
another pod's Tailscale identity or label a desktop runtime grant as mobile. The exporter retains
additional phone/auth fields already recorded in that pod's block; it does not authorize devices,
create mobile grants, restart servers, or claim a physical-phone check passed.

The export command records setup configuration locally for later inspection. `up` is still
ownership-checked and will not recreate deleted resources from an old receipt. For another pod,
use a fresh name and a fresh config. No existing sessions are migrated.
