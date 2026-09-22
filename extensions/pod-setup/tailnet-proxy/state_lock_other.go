//go:build !linux && !darwin

package main

import (
	"fmt"
	"os"
)

func lockState(string) (*os.File, error) {
	return nil, fmt.Errorf("the pod tailnet proxy requires Linux")
}
