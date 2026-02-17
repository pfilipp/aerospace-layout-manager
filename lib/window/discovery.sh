#!/bin/bash
# =============================================================================
# Window discovery and mapping for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_WINDOW_DISCOVERY_LOADED:-}" ]] && return 0
_ALM_WINDOW_DISCOVERY_LOADED=1

# Recursively collect all windows from the tree
# Returns JSON array of {bundle_id, title, original_id, source_workspace, startup}
collect_windows() {
    local node="$1"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" == "window" ]]; then
        # It's a window - extract info (including optional source-workspace and startup)
        echo "$node" | jq -c '{
            bundle_id: .["app-bundle-id"],
            title: .title,
            original_id: .["window-id"],
            source_workspace: .["source-workspace"] // "",
            startup: .startup // ""
        }'
    elif [[ "$node_type" == "container" ]]; then
        # It's a container - recurse into children
        local children
        children=$(echo "$node" | jq -c '.children[]?' 2>/dev/null || echo "")
        while IFS= read -r child; do
            if [[ -n "$child" ]]; then
                collect_windows "$child"
            fi
        done <<< "$children"
    fi
}

# Find all windows and create a mapping from original_id to new_id
# Returns JSON object mapping original_id -> new_id
# Behavior on missing windows depends on ALLOW_MISSING
create_window_mapping() {
    local root_container="$1"

    log "Discovering windows from dump..."

    local windows
    windows=$(collect_windows "$root_container")

    local mapping="{}"
    local missing_launchable=()
    local missing_fatal=()

    # Pass 1: Try to match all windows normally
    while IFS= read -r window_info; do
        if [[ -z "$window_info" ]]; then
            continue
        fi

        local bundle_id title original_id source_workspace startup
        bundle_id=$(echo "$window_info" | jq -r '.bundle_id')
        title=$(echo "$window_info" | jq -r '.title')
        original_id=$(echo "$window_info" | jq -r '.original_id')
        source_workspace=$(echo "$window_info" | jq -r '.source_workspace // empty')
        startup=$(echo "$window_info" | jq -r '.startup // empty')

        debug "Finding window: $bundle_id '$title' (original: $original_id, source: $source_workspace)"

        local new_id
        new_id=$(find_window_by_bundle_and_title "$bundle_id" "$title" "$source_workspace")

        if [[ -n "$new_id" ]]; then
            log "  Found: $bundle_id '$title' -> $new_id"
            mapping=$(echo "$mapping" | jq --arg orig "$original_id" --arg new "$new_id" '. + {($orig): $new}')
        elif [[ -n "$startup" ]]; then
            # Has a startup command — we'll try to launch it in pass 2
            missing_launchable+=("$window_info")
        else
            missing_fatal+=("$bundle_id: $title (no startup command)")
        fi
    done <<< "$windows"

    # Pass 2: Launch missing windows via staging workspace
    if [[ ${#missing_launchable[@]} -gt 0 ]]; then
        log "Launching ${#missing_launchable[@]} missing window(s) via staging workspace..."

        for window_info in "${missing_launchable[@]}"; do
            local bundle_id title original_id startup
            bundle_id=$(echo "$window_info" | jq -r '.bundle_id')
            title=$(echo "$window_info" | jq -r '.title')
            original_id=$(echo "$window_info" | jq -r '.original_id')
            startup=$(echo "$window_info" | jq -r '.startup')

            log "  Launching: $bundle_id '$title'..."

            # Snapshot windows in staging workspace before launch
            local before_snapshot
            before_snapshot=$(snapshot_staging_windows "$bundle_id")

            # Execute the startup command
            if ! execute_startup_command "$startup" "$bundle_id" "$title"; then
                missing_fatal+=("$bundle_id: $title (startup command failed)")
                continue
            fi

            # Poll for the new window
            local new_id
            new_id=$(poll_for_new_window "$bundle_id" "$before_snapshot")

            if [[ -n "$new_id" ]]; then
                log "  Launched: $bundle_id '$title' -> $new_id"
                mapping=$(echo "$mapping" | jq --arg orig "$original_id" --arg new "$new_id" '. + {($orig): $new}')
            else
                missing_fatal+=("$bundle_id: $title (launched but window never appeared)")
            fi
        done
    fi

    # Final check: report missing windows
    if [[ ${#missing_fatal[@]} -gt 0 ]]; then
        local total_windows
        total_windows=$(echo "$windows" | grep -c . || true)
        local found_windows
        found_windows=$(echo "$mapping" | jq 'length')

        error "Missing windows:"
        for m in "${missing_fatal[@]}"; do
            error "  - $m"
        done

        if [[ "${ALLOW_MISSING:-0}" != "1" ]]; then
            exit 1
        fi

        log "Continuing with $found_windows of $total_windows windows..."
    fi

    echo "$mapping"
}
