#!/bin/bash
# =============================================================================
# Window discovery and mapping for aerospace-layout-manager
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_WINDOW_DISCOVERY_LOADED:-}" ]] && return 0
_ALM_WINDOW_DISCOVERY_LOADED=1

# Recursively collect all windows from the tree
# Returns JSON array of {bundle_id, title, original_id, source_workspace}
collect_windows() {
    local node="$1"

    local node_type
    node_type=$(echo "$node" | jq -r '.type // empty')

    if [[ "$node_type" == "window" ]]; then
        # It's a window - extract info (including optional source-workspace)
        echo "$node" | jq -c '{
            bundle_id: .["app-bundle-id"],
            title: .title,
            original_id: .["window-id"],
            source_workspace: .["source-workspace"] // ""
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
# Exits with error if any window not found
create_window_mapping() {
    local root_container="$1"

    log "Discovering windows from dump..."

    local windows
    windows=$(collect_windows "$root_container")

    local mapping="{}"
    local missing=()

    while IFS= read -r window_info; do
        if [[ -z "$window_info" ]]; then
            continue
        fi

        local bundle_id title original_id source_workspace
        bundle_id=$(echo "$window_info" | jq -r '.bundle_id')
        title=$(echo "$window_info" | jq -r '.title')
        original_id=$(echo "$window_info" | jq -r '.original_id')
        source_workspace=$(echo "$window_info" | jq -r '.source_workspace // empty')

        debug "Finding window: $bundle_id '$title' (original: $original_id, source: $source_workspace)"

        local new_id
        new_id=$(find_window_by_bundle_and_title "$bundle_id" "$title" "$source_workspace")

        if [[ -z "$new_id" ]]; then
            missing+=("$bundle_id: $title")
        else
            log "  Found: $bundle_id '$title' -> $new_id"
            mapping=$(echo "$mapping" | jq --arg orig "$original_id" --arg new "$new_id" '. + {($orig): $new}')
        fi
    done <<< "$windows"

    if [[ ${#missing[@]} -gt 0 ]]; then
        error "Missing windows (not found by bundle-id AND title):"
        for m in "${missing[@]}"; do
            error "  - $m"
        done
        exit 1
    fi

    echo "$mapping"
}
