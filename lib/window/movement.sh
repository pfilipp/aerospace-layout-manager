#!/bin/bash
# =============================================================================
# Window movement functions for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_WINDOW_MOVEMENT_LOADED:-}" ]] && return 0
_ALM_WINDOW_MOVEMENT_LOADED=1

# Clear ALL windows from target workspace to temp (clean slate)
# This MUST be done first to ensure the workspace is empty before recreation
clear_workspace_to_temp() {
    local workspace="$1"

    log "Clearing all windows from workspace '$workspace' to '$TEMP_WORKSPACE'..."

    # Get all windows currently on the target workspace
    local windows_on_workspace
    windows_on_workspace=$(aerospace_list_windows --workspace "$workspace" --format "%{window-id}")

    if [[ -z "$windows_on_workspace" ]]; then
        debug "No windows on workspace $workspace"
        return
    fi

    local count=0
    while IFS= read -r wid; do
        if [[ -n "$wid" ]]; then
            debug "Moving window $wid from $workspace to $TEMP_WORKSPACE"
            aerospace_move_node_to_workspace --window-id "$wid" "$TEMP_WORKSPACE"
            ((count++))
        fi
    done <<< "$windows_on_workspace"

    log "  Moved $count windows to temp"
}

# Move dump windows to temp workspace (in case they're scattered across workspaces)
clear_dump_windows_to_temp() {
    local mapping="$1"

    log "Moving dump windows to temp workspace: $TEMP_WORKSPACE"

    echo "$mapping" | jq -r 'to_entries[] | .value' | while read -r wid; do
        if [[ -n "$wid" ]]; then
            debug "Moving $wid to $TEMP_WORKSPACE"
            aerospace_move_node_to_workspace --window-id "$wid" "$TEMP_WORKSPACE"
        fi
    done
}

# Move all windows to target workspace in DFS order
move_windows_to_workspace() {
    local root_container="$1"
    local mapping="$2"
    local workspace="$3"

    log "Moving windows to workspace: $workspace"

    move_node_windows "$root_container" "$mapping" "$workspace"
}

# Reorder root-level windows to match layout tree DFS order.
# After flatten, windows may be in arbitrary spatial positions.
# This function moves all windows to temp and back in DFS order,
# guaranteeing they appear in the correct spatial arrangement
# for Phase 1's join-with operations.
reorder_windows_to_dfs() {
    local root_container="$1"
    local mapping="$2"
    local workspace="$3"

    # Collect all real window IDs in DFS order
    local dfs_window_ids=()
    collect_dfs_window_ids "$root_container" "$mapping" dfs_window_ids

    local count=${#dfs_window_ids[@]}
    if [[ $count -eq 0 ]]; then
        debug "reorder: no windows to reorder"
        return
    fi

    debug "reorder: moving $count windows to temp for reordering"

    # Move all windows to temp (reverse order to avoid focus issues)
    local i
    for (( i=count-1; i>=0; i-- )); do
        local wid="${dfs_window_ids[$i]}"
        if [[ -n "$wid" ]]; then
            aerospace_move_node_to_workspace --window-id "$wid" "$TEMP_WORKSPACE"
        fi
    done

    # Move back in DFS order — each window appends to the end of the
    # root container, so they end up in correct spatial order
    for wid in "${dfs_window_ids[@]}"; do
        if [[ -n "$wid" ]]; then
            aerospace_move_node_to_workspace --window-id "$wid" "$workspace"
        fi
    done

    debug "reorder: $count windows repositioned in DFS order"
}

# Helper: collect real window IDs from layout tree in DFS order
collect_dfs_window_ids() {
    local node="$1"
    local mapping="$2"
    local -n _result_arr=$3

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" == "window" ]]; then
        local original_id real_id
        original_id=$(echo "$node" | jq -r '.["window-id"]')
        real_id=$(echo "$mapping" | jq -r --arg id "$original_id" '.[$id] // empty')
        if [[ -n "$real_id" ]]; then
            _result_arr+=("$real_id")
        fi
    elif [[ "$node_type" == "container" ]]; then
        local children
        children=$(echo "$node" | jq -c '.children[]?' 2>/dev/null || echo "")
        while IFS= read -r child; do
            if [[ -n "$child" ]]; then
                collect_dfs_window_ids "$child" "$mapping" _result_arr
            fi
        done <<< "$children"
    fi
}

# Recursively move windows from a node (DFS order)
move_node_windows() {
    local node="$1"
    local mapping="$2"
    local workspace="$3"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" == "window" ]]; then
        local original_id new_id
        original_id=$(echo "$node" | jq -r '.["window-id"]')
        new_id=$(echo "$mapping" | jq -r --arg id "$original_id" '.[$id] // empty')

        if [[ -n "$new_id" ]]; then
            debug "Moving window $new_id to $workspace"
            aerospace_move_node_to_workspace --window-id "$new_id" "$workspace"
        fi
    elif [[ "$node_type" == "container" ]]; then
        local children
        children=$(echo "$node" | jq -c '.children[]?' 2>/dev/null || echo "")
        while IFS= read -r child; do
            if [[ -n "$child" ]]; then
                move_node_windows "$child" "$mapping" "$workspace"
            fi
        done <<< "$children"
    fi
}
