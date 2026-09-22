package main

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

func TestPeerAllowlist(t *testing.T) {
	for _, value := range []string{"", "*", "100.64.0.0/10", "127.0.0.1", "192.168.1.1", "100.77.12.78,"} {
		if _, err := parseAllowed(value); err == nil {
			t.Fatalf("accepted unsafe allowlist %q", value)
		}
	}
	allowed, err := parseAllowed("100.77.12.78,100.94.50.24,fd7a:115c:a1e0::1")
	if err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"100.77.12.78:42", "[fd7a:115c:a1e0::1]:42"} {
		addr, _ := net.ResolveTCPAddr("tcp", address)
		if !peerAllowed(addr, allowed) {
			t.Fatalf("refused configured peer %s", address)
		}
	}
	other, _ := net.ResolveTCPAddr("tcp", "100.77.12.79:42")
	if peerAllowed(other, allowed) {
		t.Fatal("accepted a different tailnet device")
	}
}

func TestForwardAndCancellation(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			defer conn.Close()
			io.Copy(conn, conn)
		}
	}()
	client, proxy := net.Pipe()
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan struct{})
	go func() { defer close(done); forward(ctx, proxy, listener.Addr().String()) }()
	client.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := client.Write([]byte("orca")); err != nil {
		t.Fatal(err)
	}
	data := make([]byte, 4)
	if _, err := io.ReadFull(client, data); err != nil || string(data) != "orca" {
		t.Fatalf("forwarding failed: %q %v", data, err)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation did not release both connections")
	}
}
