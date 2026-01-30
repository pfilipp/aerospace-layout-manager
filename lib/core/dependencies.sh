#!/bin/bash
# =============================================================================
# Dependency checking for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_DEPENDENCIES_LOADED:-}" ]] && return 0
_ALM_DEPENDENCIES_LOADED=1

# Check that all required dependencies are available
check_dependencies() {
    if ! command -v jq &> /dev/null; then
        error "jq is required but not installed. Install with: brew install jq"
        exit 1
    fi
    if ! command -v aerospace &> /dev/null; then
        error "aerospace is required but not installed or not in PATH"
        exit 1
    fi
}
