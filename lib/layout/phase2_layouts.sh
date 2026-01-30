#!/bin/bash
# =============================================================================
# Phase 2: Layout application for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_LAYOUT_PHASE2_LOADED:-}" ]] && return 0
_ALM_LAYOUT_PHASE2_LOADED=1

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
