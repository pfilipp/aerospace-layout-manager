#!/bin/bash
# =============================================================================
# Logging functions for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_LOGGING_LOADED:-}" ]] && return 0
_ALM_LOGGING_LOADED=1

# Log an informational message to stderr
log() {
    echo "[LAYOUT-DUMP] $*" >&2
}

# Log a debug message to stderr (only when DEBUG=1)
debug() {
    if [[ "${DEBUG:-0}" == "1" ]]; then
        echo "[DEBUG] $*" >&2
    fi
}

# Log an error message to stderr
error() {
    echo "[ERROR] $*" >&2
}
