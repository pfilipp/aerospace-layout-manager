#!/bin/bash
# =============================================================================
# Window startup functions for aerospace-layout-manager
#
# Handles launching missing windows via startup commands and identifying
# newly created windows using a staging workspace approach.
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_WINDOW_STARTUP_LOADED:-}" ]] && return 0
_ALM_WINDOW_STARTUP_LOADED=1

# Execute a startup command for a missing window
# Prepends the project's bin/ dir to PATH so helpers like iterm-open are found
# Args: startup_cmd, bundle_id, title
# Returns: 0 on success, 1 on failure
execute_startup_command() {
    local startup_cmd="$1"
    local bundle_id="$2"
    local title="$3"

    debug "Executing startup command for $bundle_id '$title': $startup_cmd"

    # Prepend project's bin/ dir to PATH so helpers like iterm-open are found
    local project_bin
    project_bin="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/bin"
    local original_path="$PATH"
    export PATH="$project_bin:$PATH"

    if eval "$startup_cmd" 2>/dev/null; then
        export PATH="$original_path"
        debug "Startup command succeeded for $bundle_id '$title'"
        return 0
    else
        export PATH="$original_path"
        debug "Startup command failed for $bundle_id '$title'"
        return 1
    fi
}

# Snapshot window IDs in the staging workspace for a given bundle_id
# Switches to the staging workspace and captures current window IDs (the "before" state)
# Args: bundle_id
# Outputs: newline-separated list of window IDs (may be empty)
snapshot_staging_windows() {
    local bundle_id="$1"

    # Switch to the staging workspace
    aerospace_workspace "$STARTUP_WORKSPACE"

    # List all window IDs in the staging workspace for this bundle_id
    aerospace_list_windows --workspace "$STARTUP_WORKSPACE" --app-bundle-id "$bundle_id" --format "%{window-id}"
}

# Poll for a new window in the staging workspace by diffing against a before snapshot
# Args: bundle_id, before_snapshot (newline-separated window IDs)
# Outputs: the new window-id on stdout (empty string on timeout)
poll_for_new_window() {
    local bundle_id="$1"
    local before_snapshot="$2"

    local elapsed=0

    while (( elapsed < STARTUP_POLL_TIMEOUT )); do
        sleep "$STARTUP_POLL_INTERVAL"
        elapsed=$(( elapsed + STARTUP_POLL_INTERVAL ))

        # Get current windows in the staging workspace
        local current_windows
        current_windows=$(aerospace_list_windows --workspace "$STARTUP_WORKSPACE" --app-bundle-id "$bundle_id" --format "%{window-id}")

        # Find new window IDs by diffing
        local new_id
        new_id=$(comm -23 <(echo "$current_windows" | sort) <(echo "$before_snapshot" | sort) | head -1)

        if [[ -n "$new_id" ]]; then
            debug "Found new window $new_id after ${elapsed}s"
            echo "$new_id"
            return 0
        fi

        debug "Polling for new window ($elapsed/${STARTUP_POLL_TIMEOUT}s)..."
    done

    debug "Timeout waiting for new window from $bundle_id"
    echo ""
    return 0
}
