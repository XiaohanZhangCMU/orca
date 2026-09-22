# Direct phone access to the pod

This optional Linux-only process gives Orca its own private Tailscale endpoint. It runs as the
non-root Orca user and forwards **one TCP port** to the same port on `127.0.0.1`. The Mac and its
Kubernetes tunnel are not in the connection path. Orca's existing authentication and encryption
remain intact; the proxy never reads pairing credentials or terminal contents.

The proxy uses Tailscale's official [`tsnet`](https://tailscale.com/docs/features/tsnet) library,
pinned in `go.mod`/`go.sum`. It does not require `/dev/net/tun`, root, a Kubernetes sidecar rollout,
Orca Relay, a public port, DNS changes, or a subnet route. Unlike general userspace forwarding,
unregistered ports are refused. Only explicitly listed phone/laptop Tailscale IPs are forwarded;
tailnet access policy and Orca pairing must also allow the connection. There is no Funnel listener.

## Build

The proxy is independent of the Electron and server bundles. Go 1.26.6 or its automatic toolchain
download is required. From this directory, cross-build a Linux x64 binary:

```sh
go mod download
go test -race ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath \
  -o ../../../out/pod-setup/orca-tailnet-proxy .
```

Use `GOARCH=arm64` for an ARM pod. These commands use POSIX environment syntax; Windows users can
run them in WSL or set the equivalent environment variables in PowerShell. The launcher and proxy
itself run **inside Linux**, not on the laptop. `CGO_ENABLED=0` avoids a newer host glibc dependency.

From the repository root, also build the non-root launcher:

```sh
node extensions/pod-setup/build.mjs
```

Copy `out/pod-setup/orca-tailnet-proxy` and `out/pod-setup/tailnet-launch.cjs` into a new private,
account-owned directory on the pod. Do not overwrite a running executable. No Go installation is
needed on the pod; the launcher uses its existing Node 24 installation.

## Start and authorize

As the non-root user, substitute the actual Tailscale IPs of the phone and laptop:

```sh
node /path/to/tailnet-launch.cjs \
  --proxy /path/to/orca-tailnet-proxy \
  --hostname k8s-cpu-orca --port 6770 \
  --allow PHONE_TAILSCALE_IP,LAPTOP_TAILSCALE_IP
```

The launcher detaches the process, preserves its logs, and refuses to restart or overwrite a
different live proxy. Its state is `~/.local/state/orca-tailnet`, with mode 0700. The proxy also
holds an OS file lock, preventing two instances from using the same Tailscale identity.

On first launch, open the authorization URL in the private `proxy.log` and authorize the named
device in the **same tailnet as your phone**. Do not paste auth keys into chat or commit them.
After authorization, the latest `ready.jsonl` entry lists the proxy PID, Tailscale IPs, port, and
allowlist. Match its PID against `proxy-pid.json`; a historical ready line is not proof of liveness.
Node keys remain in the private state directory. Restrict the node to these devices and port in
your tailnet policy too, especially when sharing a tailnet with other people.

## Pair the phone to Orca

The Node-only Orca server now accepts the same `--mobile-pairing` option as the Electron server:

```sh
node out/orcad/orcad.js --bind 127.0.0.1 --port 6770 \
  --pairing-address ws://POD_TAILSCALE_IP:6770 --mobile-pairing --json
```

This is a **startup command**, not a command to run alongside an existing server. For an already
running Orca host, follow the process-scoped restart guidance before replacing it; never restart
the pod or stop the terminal daemon. Keep the same profile and runtime install directory.
Default startup still prints a desktop/runtime grant. Explicit mobile startup creates a separate,
mobile-scoped grant and does not revoke already paired desktop clients. Existing pending mobile
grants may be reused, consistent with Orca's normal pairing behavior.

The private readiness record contains `pairing.url`. Paste that into Orca Mobile's pairing flow
or render it as a QR with Orca's existing QR encoder. Keep Tailscale connected on the phone. Do
not scan **Pair this Mac**, and do not use a `127.0.0.1` address on the phone. The proxy does not
automatically create or rewrite credentials, and the tailnet login URL is not an Orca pairing URL.

## Verification and recovery

- Confirm the proxy's current PID and the latest matching readiness record.
- From an allowed device, verify the Tailscale address reaches Orca on the configured port.
- Use the phone's actual mobile-scoped pairing to check `status.get`, workspace inventory, and
  terminal viewing. A successful TCP connection alone is not a successful Orca pairing.
- Verify unrelated pod ports are refused through this Tailscale identity.
- If a device's Tailscale IP changes, update the allowlist and restart **only the exact proxy**
  after checking its PID, start time, executable and owner. Existing Orca processes stay running.
- Pod deletion still loses live processes. Persist the state directory on a protected volume if
  the tailnet identity should survive replacement. Never run two pods from the same node state.
- Logs can contain authorization URLs and device metadata. Keep them private. There is no
  automatic log rotation, system service, or cluster controller in this small extension.

The launcher never edits tailnet ACLs, approves devices, or performs Orca server upgrades for you.
