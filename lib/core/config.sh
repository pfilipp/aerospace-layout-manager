#!/bin/bash
# =============================================================================
# Configuration constants for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_CONFIG_LOADED:-}" ]] && return 0
_ALM_CONFIG_LOADED=1

# Temporary workspace used during layout operations
TEMP_WORKSPACE="${AEROSPACE_TEMP_WORKSPACE:-temp}"

# Debug mode (set DEBUG=1 to enable verbose logging)
DEBUG="${DEBUG:-0}"
