#!/bin/bash
# =============================================================================
# Tree traversal utilities for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_TREE_TRAVERSAL_LOADED:-}" ]] && return 0
_ALM_TREE_TRAVERSAL_LOADED=1

# Get the representative window ID for a node (first window in DFS order)
get_first_window_id() {
    local node="$1"
    local mapping="$2"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" == "window" ]]; then
        local original_id
        original_id=$(echo "$node" | jq -r '.["window-id"]')
        echo "$mapping" | jq -r --arg id "$original_id" '.[$id] // empty'
    elif [[ "$node_type" == "container" ]]; then
        local first_child
        first_child=$(echo "$node" | jq -c '.children[0]?' 2>/dev/null || echo "")
        if [[ -n "$first_child" ]]; then
            get_first_window_id "$first_child" "$mapping"
        fi
    fi
}

# Get the LAST window ID for a node (last window in DFS order)
get_last_window_id() {
    local node="$1"
    local mapping="$2"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" == "window" ]]; then
        local original_id
        original_id=$(echo "$node" | jq -r '.["window-id"]')
        echo "$mapping" | jq -r --arg id "$original_id" '.[$id] // empty'
    elif [[ "$node_type" == "container" ]]; then
        local last_child
        last_child=$(echo "$node" | jq -c '.children[-1]?' 2>/dev/null || echo "")
        if [[ -n "$last_child" ]]; then
            get_last_window_id "$last_child" "$mapping"
        fi
    fi
}
