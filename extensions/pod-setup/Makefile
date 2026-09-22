REPO_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST)))/../..)
CONFIG ?= extensions/pod-setup/cluster.example.json
NODE ?= node
LOCAL_PORT ?= 6771

.PHONY: build dry-run up status verify shell connect pairing export-env test
build:
	cd "$(REPO_ROOT)" && $(NODE) extensions/pod-setup/build.mjs

dry-run up status verify shell connect pairing export-env: build
	cd "$(REPO_ROOT)" && ORCA_BACKGROUND_LAUNCH=1 $(NODE) out/pod-setup/cluster.cjs $@ --config "$(CONFIG)" --local-port "$(LOCAL_PORT)"

test:
	cd "$(REPO_ROOT)" && $(NODE) node_modules/typescript/bin/tsc -p extensions/pod-setup/tsconfig.json --noEmit
	cd "$(REPO_ROOT)" && ORCA_BACKGROUND_LAUNCH=1 $(NODE) node_modules/vitest/vitest.mjs run --config extensions/pod-setup/vitest.config.ts
