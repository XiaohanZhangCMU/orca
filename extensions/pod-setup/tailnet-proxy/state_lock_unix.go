//go:build linux || darwin

package main

import (
	"fmt"
	"os"
	"syscall"
)

func lockState(path string) (*os.File, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("another proxy owns this state directory: %w", err)
	}
	return file, nil
}
