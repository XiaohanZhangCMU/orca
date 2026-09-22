//go:build linux || darwin

package main

import (
	"path/filepath"
	"testing"
)

func TestStateLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "proxy.lock")
	first, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	if second, err := lockState(path); err == nil {
		second.Close()
		t.Fatal("two processes could own the same node state")
	}
	first.Close()
	third, err := lockState(path)
	if err != nil {
		t.Fatal(err)
	}
	third.Close()
}
