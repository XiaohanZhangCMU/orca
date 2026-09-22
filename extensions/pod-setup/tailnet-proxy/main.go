package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"net/netip"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"syscall"

	"tailscale.com/tsnet"
)

func main() {
	if err := run(); err != nil {
		log.Print(err)
		os.Exit(1)
	}
}

func run() error {
	hostname := flag.String("hostname", "k8s-cpu-orca", "dedicated tailnet device name")
	port := flag.Int("port", 6770, "Orca port, on the tailnet and local loopback")
	allow := flag.String("allow", "", "comma-separated exact Tailscale IPs allowed to connect")
	state := flag.String("state-dir", "", "private persistent Tailscale state directory")
	flag.Parse()
	if runtime.GOOS != "linux" || os.Getuid() < 1000 {
		return fmt.Errorf("run inside the Linux pod as its dedicated non-root Orca user")
	}
	if *port < 1024 || *port > 65535 || flag.NArg() != 0 {
		return fmt.Errorf("expected an unprivileged TCP port and no positional arguments")
	}
	allowed, err := parseAllowed(*allow)
	if err != nil {
		return err
	}
	if *state == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		*state = filepath.Join(home, ".local", "state", "orca-tailnet")
	}
	if err := os.MkdirAll(*state, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(*state)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("state directory must be private (0700) and not a symlink")
	}
	// A live tsnet instance owns this node identity; never share it with a second process.
	lock, err := lockState(filepath.Join(*state, "proxy.lock"))
	if err != nil {
		return err
	}
	defer lock.Close()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	server := &tsnet.Server{Dir: *state, Hostname: *hostname, UserLogf: log.Printf}
	defer server.Close()
	status, err := server.Up(ctx)
	if err != nil {
		return err
	}
	listener, err := server.Listen("tcp", ":"+strconv.Itoa(*port))
	if err != nil {
		return err
	}
	defer listener.Close()
	context.AfterFunc(ctx, func() { listener.Close() })
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{
		"ready": true, "pid": os.Getpid(), "hostname": *hostname,
		"ips": status.TailscaleIPs, "port": *port, "allowed": allowed,
	}); err != nil {
		return err
	}
	backend := net.JoinHostPort("127.0.0.1", strconv.Itoa(*port))
	slots := make(chan struct{}, 32)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			return err
		}
		if !peerAllowed(conn.RemoteAddr(), allowed) {
			conn.Close()
			continue
		}
		select {
		case slots <- struct{}{}:
			go func() {
				defer func() { <-slots }()
				forward(ctx, conn, backend)
			}()
		default:
			conn.Close()
		}
	}
}

func peerAllowed(peer net.Addr, allowed []netip.Addr) bool {
	host, _, err := net.SplitHostPort(peer.String())
	if err != nil {
		return false
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	for _, candidate := range allowed {
		if addr.Unmap() == candidate {
			return true
		}
	}
	return false
}
