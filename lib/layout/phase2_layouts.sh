#!/bin/bash
# =============================================================================
# Phase 2: Layout application for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_LAYOUT_PHASE2_LOADED:-}" ]] && return 0
_ALM_LAYOUT_PHASE2_LOADED=1

# Set the root container's layout safely.
#
# `aerospace layout` targets the PARENT container of the focused window.
# After Phase 1, windows may be inside nested containers. Focusing such
# a window and calling `aerospace layout` would change the nested
# container's layout, not the root's.
#
# Strategy:
# 1. Query the LIVE tree for a window that's directly under root
# 2. If found → focus it, set layout (targets root)
# 3. If not found → root layout was set in Step 6 and joins preserve it,
#    so skip re-application rather than risk corrupting nested containers
set_root_layout() {
    local root_layout="$1"
    local workspace="$2"
    local mapping="$3"
    local root_container="$4"

    # Query the live tree to find a window directly under the root container
    local root_window_id
    root_window_id=$(aerospace tree --json --workspace "$workspace" 2>/dev/null | jq -r '
        # Navigate to root container (workspace > root-container or first container)
        if type == "array" then .[0] else . end |
        if .type == "workspace" then
            (.["root-container"] // .children[0] // .)
        else . end |
        # Find first direct window child
        (.children // []) | map(select(.type == "window")) |
        .[0]["window-id"] // null
    ' 2>/dev/null || echo "null")

    if [[ -n "$root_window_id" && "$root_window_id" != "null" ]]; then
        debug "set_root_layout: found root-level window $root_window_id"
        aerospace_focus --window-id "$root_window_id"
        aerospace_layout "$root_layout"
    else
        debug "set_root_layout: no root-level windows, skipping (root layout preserved from Step 6)"
    fi
}

# Second pass: Apply layouts to all containers (post-order traversal)
# This is done after all joins to prevent layout changes from affecting subsequent joins
apply_layouts() {
    local node="$1"
    local mapping="$2"
    local workspace="$3"
    local is_root="${4:-false}"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" != "container" ]]; then
        return
    fi

    local layout
    layout=$(echo "$node" | jq -r '.layout // empty')

    local children_json
    children_json=$(echo "$node" | jq -c '.children // []')

    local num_children
    num_children=$(echo "$children_json" | jq 'length')

    # First, recursively process all child containers
    local child_idx=0
    while [[ $child_idx -lt $num_children ]]; do
        local child
        child=$(echo "$children_json" | jq -c ".[$child_idx]")
        local child_type
        child_type=$(echo "$child" | jq -r '.type // empty')

        if [[ "$child_type" == "container" ]]; then
            apply_layouts "$child" "$mapping" "$workspace" "false"
        fi

        ((child_idx++))
    done

    # Skip root - its layout is already set
    if [[ "$is_root" == "true" ]]; then
        return
    fi

    # Apply the layout type to this container
    if [[ "$num_children" -gt 0 ]]; then
        local first_child
        first_child=$(echo "$children_json" | jq -c '.[0]')
        local rep_window_id
        rep_window_id=$(get_first_window_id "$first_child" "$mapping")

        if [[ -n "$rep_window_id" ]]; then
            debug "Setting layout $layout on container (via window $rep_window_id)"
            aerospace_focus --window-id "$rep_window_id"
            aerospace_layout "$layout"
        fi
    fi
}
