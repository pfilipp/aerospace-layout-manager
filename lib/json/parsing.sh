#!/bin/bash
# =============================================================================
# JSON parsing utilities for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_JSON_PARSING_LOADED:-}" ]] && return 0
_ALM_JSON_PARSING_LOADED=1

# Extract workspace name from dump-tree JSON
# Input: full dump-tree JSON (array of workspaces)
# Output: workspace name from JSON
get_workspace_from_dump() {
    local json="$1"
    echo "$json" | jq -r '.[0].name // empty'
}

# Get root container from dump-tree JSON
# Input: full dump-tree JSON
# Output: root-container JSON object
get_root_container() {
    local json="$1"
    echo "$json" | jq -c '.[0]["root-container"]'
}
