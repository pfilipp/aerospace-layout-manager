#!/usr/bin/env bash
# =============================================================================
# Data access layer for alm-config
#
# Manages projects.json read/write operations: project CRUD,
# workspace assignment, and atomic file writes.
# =============================================================================

# Prevent double-sourcing
[[ -n "${_ALM_CONFIG_DATA_LOADED:-}" ]] && return 0
_ALM_CONFIG_DATA_LOADED=1

# Directories and files
ALM_CONFIG_DIR="${ALM_CONFIG_DIR:-$HOME/.config/aerospace}"
ALM_LAYOUTS_DIR="${ALM_LAYOUTS_DIR:-$ALM_CONFIG_DIR/layouts}"
ALM_PROJECTS_FILE="${ALM_PROJECTS_FILE:-$ALM_CONFIG_DIR/projects.json}"

# =============================================================================
# config_init
#
# Ensure ~/.config/aerospace/ and subdirs exist, create projects.json if missing.
# =============================================================================
config_init() {
    mkdir -p "$ALM_CONFIG_DIR"
    mkdir -p "$ALM_LAYOUTS_DIR"
    mkdir -p "$ALM_LAYOUTS_DIR/avp"

    if [[ ! -f "$ALM_PROJECTS_FILE" ]]; then
        local default_json='{
  "projects": {},
  "workspaces": {
    "code": { "project": null, "active": true },
    "code2": { "project": null, "active": false },
    "code3": { "project": null, "active": false },
    "homelab": { "project": null, "active": true }
  }
}'
        _atomic_write "$default_json"
    fi
}

# =============================================================================
# config_read
#
# Read and output the full projects.json content.
# =============================================================================
config_read() {
    if [[ ! -f "$ALM_PROJECTS_FILE" ]]; then
        echo "{}"
        return 1
    fi
    cat "$ALM_PROJECTS_FILE"
}

# =============================================================================
# project_list
#
# List all project names, one per line.
# =============================================================================
project_list() {
    if [[ ! -f "$ALM_PROJECTS_FILE" ]]; then
        return 0
    fi
    jq -r '.projects | keys[]' "$ALM_PROJECTS_FILE" 2>/dev/null
}

# =============================================================================
# project_get <name>
#
# Output the project JSON object for the given name.
# Returns 1 if not found.
# =============================================================================
project_get() {
    local name="$1"
    local result
    result=$(jq --arg name "$name" '.projects[$name] // empty' "$ALM_PROJECTS_FILE" 2>/dev/null)
    if [[ -z "$result" ]]; then
        return 1
    fi
    echo "$result"
}

# =============================================================================
# project_set <name> <json>
#
# Create or update a project. The json should be a complete project object.
# =============================================================================
project_set() {
    local name="$1"
    local project_json="$2"

    local current
    current=$(config_read)

    local updated
    updated=$(echo "$current" | jq --arg name "$name" --argjson proj "$project_json" \
        '.projects[$name] = $proj')

    _atomic_write "$updated"
}

# =============================================================================
# project_delete <name>
#
# Remove a project and unbind it from any workspace that references it.
# =============================================================================
project_delete() {
    local name="$1"

    local current
    current=$(config_read)

    local updated
    updated=$(echo "$current" | jq --arg name "$name" '
        .projects |= del(.[$name])
        | .workspaces |= with_entries(
            if .value.project == $name then .value.project = null else . end
        )
    ')

    _atomic_write "$updated"
}

# =============================================================================
# workspace_get <ws>
#
# Output the assigned project name for a workspace, or empty string.
# =============================================================================
workspace_get() {
    local ws="$1"
    jq -r --arg ws "$ws" '.workspaces[$ws].project // empty' "$ALM_PROJECTS_FILE" 2>/dev/null
}

# =============================================================================
# workspace_set <ws> <project>
#
# Assign a project to a workspace.
# =============================================================================
workspace_set() {
    local ws="$1"
    local project="$2"

    local current
    current=$(config_read)

    local updated
    updated=$(echo "$current" | jq --arg ws "$ws" --arg proj "$project" \
        '.workspaces[$ws].project = $proj')

    _atomic_write "$updated"
}

# =============================================================================
# workspace_clear <ws>
#
# Unassign a workspace (set project to null).
# =============================================================================
workspace_clear() {
    local ws="$1"

    local current
    current=$(config_read)

    local updated
    updated=$(echo "$current" | jq --arg ws "$ws" \
        '.workspaces[$ws].project = null')

    _atomic_write "$updated"
}

# =============================================================================
# workspace_active <ws> <bool>
#
# Set the active flag for a workspace (true/false as string).
# =============================================================================
workspace_active() {
    local ws="$1"
    local active="$2"

    local current
    current=$(config_read)

    local bool_val="false"
    [[ "$active" == "true" ]] && bool_val="true"

    local updated
    updated=$(echo "$current" | jq --arg ws "$ws" --argjson active "$bool_val" \
        '.workspaces[$ws].active = $active')

    _atomic_write "$updated"
}

# =============================================================================
# _atomic_write <json_content>
#
# Write JSON content to projects.json atomically (temp file + rename).
# =============================================================================
_atomic_write() {
    local content="$1"
    local tmp_file="${ALM_PROJECTS_FILE}.tmp.$$"

    if echo "$content" | jq '.' > "$tmp_file" 2>/dev/null; then
        mv -f "$tmp_file" "$ALM_PROJECTS_FILE"
    else
        rm -f "$tmp_file"
        echo "[ERROR] Failed to write projects.json" >&2
        return 1
    fi
}
