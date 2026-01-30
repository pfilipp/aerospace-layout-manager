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
