package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strings"
	"time"
)

func parseAllowed(text string) ([]netip.Addr, error) {
	var allowed []netip.Addr
	ipv4 := netip.MustParsePrefix("100.64.0.0/10")
	ipv6 := netip.MustParsePrefix("fd7a:115c:a1e0::/48")
	for _, entry := range strings.Split(text, ",") {
		addr, err := netip.ParseAddr(strings.TrimSpace(entry))
		if err != nil || addr.Zone() != "" || (!ipv4.Contains(addr) && !ipv6.Contains(addr)) {
			return nil, fmt.Errorf("-allow requires exact Tailscale IPs; wildcards and subnets are refused")
		}
		allowed = append(allowed, addr)
	}
	return allowed, nil
}

func forward(ctx context.Context, incoming net.Conn, backend string) {
	defer incoming.Close()
	dialer := net.Dialer{Timeout: 10 * time.Second}
	outgoing, err := dialer.DialContext(ctx, "tcp", backend)
	if err != nil {
		return
	}
	defer outgoing.Close()
	stop := context.AfterFunc(ctx, func() {
		incoming.Close()
		outgoing.Close()
	})
	defer stop()
	done := make(chan struct{})
	go func() {
		defer close(done)
		io.Copy(outgoing, incoming)
		closeWrite(outgoing)
	}()
	io.Copy(incoming, outgoing)
	incoming.Close()
	outgoing.Close()
	<-done
}

func closeWrite(conn net.Conn) {
	if half, ok := conn.(interface{ CloseWrite() error }); ok {
		half.CloseWrite()
	} else {
		conn.Close()
	}
}
