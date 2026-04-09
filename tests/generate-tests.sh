#!/usr/bin/env bash
#
# Generation Module Tests
# Tests for lib/config/generate.sh — variable substitution, app filtering,
# container pruning, container collapse, field preservation, edge cases,
# window-id renumbering, and JSON validation.
#
# Usage:
#   ./tests/generate-tests.sh           # Run all tests
#   ./tests/generate-tests.sh 2.3       # Run specific test
#   ./tests/generate-tests.sh --list    # List available tests
#
# These tests are pure-function tests — no aerospace instance required.
#

set -euo pipefail

# Configuration
VERBOSE="${VERBOSE:-false}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test tracking
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Resolve script and repo directories
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Temp directory for test fixtures and output
TEST_TMP=""

#---------------------------------------------------------------------------
# Utility Functions
#---------------------------------------------------------------------------

log_info() {
    echo -e "${BLUE}[INFO]${NC} $*"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $*"
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $*"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

log_verbose() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BLUE}[VERB]${NC} $*"
    fi
}

# Create temp directory and set up environment
setup_test_env() {
    TEST_TMP=$(mktemp -d)

    # Override ALM environment variables so generate.sh uses our fixtures
    export ALM_REPO_ROOT="$TEST_TMP/repo"
    export ALM_CONFIG_DIR="$TEST_TMP/config"
    export ALM_LAYOUTS_DIR="$TEST_TMP/config/layouts"
    export ALM_PROJECTS_FILE="$TEST_TMP/config/projects.json"

    mkdir -p "$ALM_REPO_ROOT/templates/dual"
    mkdir -p "$ALM_REPO_ROOT/templates/avp"
    mkdir -p "$ALM_CONFIG_DIR/layouts/avp"

    # Reset double-source guard so generate.sh can be re-sourced
    unset _ALM_CONFIG_GENERATE_LOADED

    # Source the module under test
    # shellcheck source=../lib/config/generate.sh
    source "$REPO_ROOT/lib/config/generate.sh"
}

# Clean up temp directory
teardown_test_env() {
    if [[ -n "$TEST_TMP" && -d "$TEST_TMP" ]]; then
        rm -rf "$TEST_TMP"
    fi
}

# Write a minimal template fixture
write_template() {
    local mode="$1"   # dual or avp
    local ws="$2"     # workspace name
    local json="$3"   # JSON content
    echo "$json" > "$ALM_REPO_ROOT/templates/$mode/$ws.json"
}

# Write a projects.json fixture
write_projects() {
    local json="$1"
    echo "$json" > "$ALM_PROJECTS_FILE"
}

# Assert two values are equal
assert_eq() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"

    if [[ "$expected" == "$actual" ]]; then
        log_verbose "ASSERT OK: $msg"
        return 0
    else
        log_fail "ASSERT FAILED: $msg"
        log_fail "  expected: $expected"
        log_fail "  actual:   $actual"
        return 1
    fi
}

# Assert JSON output matches expected (normalized via jq -Sc)
assert_json_eq() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-}"

    local norm_expected norm_actual
    norm_expected=$(echo "$expected" | jq -Sc '.')
    norm_actual=$(echo "$actual" | jq -Sc '.')

    if [[ "$norm_expected" == "$norm_actual" ]]; then
        log_verbose "ASSERT JSON OK: $msg"
        return 0
    else
        log_fail "ASSERT JSON FAILED: $msg"
        log_fail "  expected: $norm_expected"
        log_fail "  actual:   $norm_actual"
        return 1
    fi
}

# Assert a jq expression against JSON yields a specific value
assert_jq() {
    local json="$1"
    local expr="$2"
    local expected="$3"
    local msg="${4:-jq $expr == $expected}"

    local actual
    actual=$(echo "$json" | jq -r "$expr")

    assert_eq "$expected" "$actual" "$msg"
}

#---------------------------------------------------------------------------
# Test Framework
#---------------------------------------------------------------------------

run_test() {
    local test_id="$1"
    local test_name="$2"
    local test_func="$3"

    echo ""
    echo "=============================================="
    echo "Test $test_id: $test_name"
    echo "=============================================="

    TESTS_RUN=$((TESTS_RUN + 1))

    # Fresh environment for each test
    teardown_test_env
    setup_test_env

    # Run the test
    if $test_func; then
        log_pass "Test $test_id PASSED"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        log_fail "Test $test_id FAILED"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

#---------------------------------------------------------------------------
# Fixtures — small JSON snippets for focused tests
#---------------------------------------------------------------------------

# Minimal template with 2 project-variable windows
fixture_simple_template() {
    cat <<'EOF'
[{
  "name": "code",
  "type": "workspace",
  "root-container": {
    "type": "container",
    "layout": "h_accordion",
    "orientation": "horizontal",
    "children": [
      {
        "type": "window",
        "app-bundle-id": "com.microsoft.VSCode",
        "app-name": "Code",
        "title": "${PROJECT_NAME}",
        "window-id": 1,
        "startup": "code ${PROJECT_DIR}/${PROJECT_SUBDIR}"
      },
      {
        "type": "window",
        "app-bundle-id": "com.googlecode.iterm2",
        "app-name": "iTerm2",
        "title": "${PROJECT_NAME}",
        "window-id": 2,
        "startup": "~/nix-config/modules/darwin/scripts/iterm-window.sh '${PROJECT_ITERM_CMD}'"
      }
    ]
  }
}]
EOF
}

# Template with Xcode window and source-workspace field
fixture_template_with_xcode_and_source_ws() {
    cat <<'EOF'
[{
  "name": "code",
  "type": "workspace",
  "root-container": {
    "type": "container",
    "layout": "h_accordion",
    "orientation": "horizontal",
    "children": [
      {
        "type": "window",
        "app-bundle-id": "com.microsoft.VSCode",
        "app-name": "Code",
        "title": "${PROJECT_NAME}",
        "window-id": 1,
        "startup": "code ${PROJECT_DIR}/${PROJECT_SUBDIR}"
      },
      {
        "type": "window",
        "app-bundle-id": "com.apple.dt.Xcode",
        "app-name": "Xcode",
        "title": "${PROJECT_NAME}",
        "window-id": 2,
        "startup": "open ${PROJECT_DIR}/${PROJECT_XCODEPROJ}"
      },
      {
        "type": "window",
        "app-bundle-id": "com.apple.Safari",
        "app-name": "Safari",
        "title": "",
        "window-id": 3,
        "source-workspace": "temp",
        "startup": "safari-new"
      }
    ]
  }
}]
EOF
}

# Template with nested containers (AVP style)
fixture_nested_template() {
    cat <<'EOF'
[{
  "name": "code",
  "type": "workspace",
  "root-container": {
    "type": "container",
    "layout": "h_tiles",
    "orientation": "horizontal",
    "children": [
      {
        "type": "container",
        "layout": "v_accordion",
        "orientation": "vertical",
        "children": [
          {
            "type": "window",
            "app-bundle-id": "com.apple.Safari",
            "app-name": "Safari",
            "title": "",
            "window-id": 1,
            "source-workspace": "temp",
            "startup": "safari-new"
          },
          {
            "type": "window",
            "app-bundle-id": "com.figma.Desktop",
            "app-name": "Figma",
            "title": "",
            "window-id": 2,
            "startup": "open -a Figma"
          }
        ]
      },
      {
        "type": "container",
        "layout": "v_accordion",
        "orientation": "vertical",
        "children": [
          {
            "type": "window",
            "app-bundle-id": "com.microsoft.VSCode",
            "app-name": "Code",
            "title": "${PROJECT_NAME}",
            "window-id": 3,
            "startup": "code ${PROJECT_DIR}/${PROJECT_SUBDIR}"
          },
          {
            "type": "window",
            "app-bundle-id": "com.googlecode.iterm2",
            "app-name": "iTerm2",
            "title": "${PROJECT_NAME}",
            "window-id": 4,
            "startup": "~/nix-config/modules/darwin/scripts/iterm-window.sh '${PROJECT_ITERM_CMD}'"
          }
        ]
      },
      {
        "type": "container",
        "layout": "v_accordion",
        "orientation": "vertical",
        "children": [
          {
            "type": "window",
            "app-bundle-id": "com.tinyspeck.slackmacgap",
            "app-name": "Slack",
            "title": "",
            "window-id": 5,
            "startup": "open -a Slack"
          },
          {
            "type": "window",
            "app-bundle-id": "com.brave.Browser",
            "app-name": "Brave Browser",
            "title": "",
            "window-id": 6,
            "startup": "open -a \"Brave Browser\""
          }
        ]
      }
    ]
  }
}]
EOF
}

#---------------------------------------------------------------------------
# Test 2.1: Variable Substitution
#---------------------------------------------------------------------------

test_2_1_variable_substitution() {
    log_info "Testing variable substitution for all PROJECT_* vars"

    local template
    template=$(fixture_simple_template)

    local result
    result=$(substitute_vars "$template" \
        "myproject" \
        "/Users/test/Projects/myproject" \
        "frontend" \
        "tmux-myproject" \
        "MyApp.xcodeproj")

    # Check PROJECT_NAME substituted
    assert_jq "$result" '.[0]."root-container".children[0].title' "myproject" "PROJECT_NAME in title" || return 1

    # Check PROJECT_DIR/PROJECT_SUBDIR combined path
    assert_jq "$result" '.[0]."root-container".children[0].startup' "code /Users/test/Projects/myproject/frontend" "PROJECT_DIR/PROJECT_SUBDIR in startup" || return 1

    # Check PROJECT_ITERM_CMD substituted
    assert_jq "$result" '.[0]."root-container".children[1].startup' "~/nix-config/modules/darwin/scripts/iterm-window.sh 'tmux-myproject'" "PROJECT_ITERM_CMD in iterm startup" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.2: Empty PROJECT_SUBDIR — no trailing slash
#---------------------------------------------------------------------------

test_2_2_empty_subdir_no_trailing_slash() {
    log_info "Testing empty PROJECT_SUBDIR produces no trailing slash"

    local template
    template=$(fixture_simple_template)

    local result
    result=$(substitute_vars "$template" \
        "myproject" \
        "/Users/test/Projects/myproject" \
        "" \
        "tmux-myproject" \
        "")

    # The pattern ${PROJECT_DIR}/${PROJECT_SUBDIR} should become just the dir, no trailing slash
    local startup
    startup=$(echo "$result" | jq -r '.[0]."root-container".children[0].startup')

    assert_eq "code /Users/test/Projects/myproject" "$startup" "No trailing slash when subdir empty" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.3: App Filtering — removes non-included apps
#---------------------------------------------------------------------------

test_2_3_app_filtering() {
    log_info "Testing app filtering removes windows not in include list"

    local template
    template=$(fixture_template_with_xcode_and_source_ws)

    # Only include VSCode and Safari (Xcode should be removed)
    local apps_json='["com.microsoft.VSCode", "com.apple.Safari"]'

    local result
    result=$(filter_apps "$template" "$apps_json" "MyApp.xcodeproj")

    # Should have 2 windows remaining
    local count
    count=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window")] | length')

    assert_eq "2" "$count" "2 windows remain after filtering" || return 1

    # VSCode should be present
    local has_vscode
    has_vscode=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.microsoft.VSCode")] | length')
    assert_eq "1" "$has_vscode" "VSCode window present" || return 1

    # Xcode should NOT be present
    local has_xcode
    has_xcode=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.apple.dt.Xcode")] | length')
    assert_eq "0" "$has_xcode" "Xcode window removed" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.4: Container Pruning — removes empty containers
#---------------------------------------------------------------------------

test_2_4_container_pruning() {
    log_info "Testing container pruning removes containers with 0 children"

    # Start with nested template, filter out ALL apps in left container
    local template
    template=$(fixture_nested_template)

    # Only include VSCode and iTerm — removes Safari, Figma, Slack, Brave
    local apps_json='["com.microsoft.VSCode", "com.googlecode.iterm2"]'
    local filtered
    filtered=$(filter_apps "$template" "$apps_json" "")

    # After filtering, left and right containers should be empty
    local pruned
    pruned=$(prune_containers "$filtered")

    # Should have exactly 1 container remaining (the center one with VSCode+iTerm)
    # plus the root container — so 2 total containers
    local container_count
    container_count=$(echo "$pruned" | jq '[.. | select(type == "object" and .type == "container")] | length')

    # Root container + the surviving center container = 2
    assert_eq "2" "$container_count" "Only root + 1 child container remain after pruning" || return 1

    # Should have exactly 2 windows
    local window_count
    window_count=$(echo "$pruned" | jq '[.. | select(type == "object" and .type == "window")] | length')
    assert_eq "2" "$window_count" "2 windows remain after pruning" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.5: Container Collapse — single-child container promotion
#---------------------------------------------------------------------------

test_2_5_container_collapse() {
    log_info "Testing container collapse promotes single container child"

    # After pruning in test 2.4, root has 1 container child — should be collapsed
    local template
    template=$(fixture_nested_template)

    local apps_json='["com.microsoft.VSCode", "com.googlecode.iterm2"]'
    local filtered
    filtered=$(filter_apps "$template" "$apps_json" "")

    local pruned
    pruned=$(prune_containers "$filtered")

    local collapsed
    collapsed=$(collapse_containers "$pruned")

    # Root container should now have the center container's properties
    # (it was promoted since it was the single child)
    local root_layout
    root_layout=$(echo "$collapsed" | jq -r '.[0]."root-container".layout')
    assert_eq "v_accordion" "$root_layout" "Root layout is promoted child's v_accordion" || return 1

    # Root container children should be the windows directly
    local root_children_count
    root_children_count=$(echo "$collapsed" | jq '.[0]."root-container".children | length')
    assert_eq "2" "$root_children_count" "Root has 2 direct children (windows)" || return 1

    # Children should be windows, not containers
    local child_types
    child_types=$(echo "$collapsed" | jq -r '[.[0]."root-container".children[].type] | unique | join(",")')
    assert_eq "window" "$child_types" "All children are windows" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.6: Field Preservation — source-workspace survives transforms
#---------------------------------------------------------------------------

test_2_6_field_preservation() {
    log_info "Testing source-workspace and other fields preserved through pipeline"

    local template
    template=$(fixture_template_with_xcode_and_source_ws)

    # Include all apps (VSCode, Xcode, Safari) so nothing is filtered
    local apps_json='["com.microsoft.VSCode", "com.apple.dt.Xcode", "com.apple.Safari"]'

    # Run through substitute_vars
    local subst
    subst=$(substitute_vars "$template" "myproject" "/Users/test/proj" "" "tmux-mp" "App.xcodeproj")

    # Run through filter_apps (all included)
    local filtered
    filtered=$(filter_apps "$subst" "$apps_json" "App.xcodeproj")

    # Run through prune (nothing to prune)
    local pruned
    pruned=$(prune_containers "$filtered")

    # Run through collapse (nothing to collapse)
    local collapsed
    collapsed=$(collapse_containers "$pruned")

    # Run through renumber
    local result
    result=$(renumber_windows "$collapsed")

    # Check source-workspace is still on the Safari window
    local source_ws
    source_ws=$(echo "$result" | jq -r '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.apple.Safari")][0]."source-workspace"')
    assert_eq "temp" "$source_ws" "source-workspace preserved on Safari window" || return 1

    # Ensure other windows do NOT have source-workspace (it was never there)
    local vscode_source
    vscode_source=$(echo "$result" | jq -r '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.microsoft.VSCode")][0]."source-workspace" // "absent"')
    assert_eq "absent" "$vscode_source" "VSCode has no source-workspace (correctly absent)" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.7: Field Preservation in nested containers
#---------------------------------------------------------------------------

test_2_7_field_preservation_nested() {
    log_info "Testing source-workspace preserved in nested container structures"

    local template
    template=$(fixture_nested_template)

    # Include Safari, VSCode, iTerm — filter out Figma, Slack, Brave
    local apps_json='["com.apple.Safari", "com.microsoft.VSCode", "com.googlecode.iterm2"]'

    local subst
    subst=$(substitute_vars "$template" "proj" "/home/test" "sub" "tmux-p" "")

    local filtered
    filtered=$(filter_apps "$subst" "$apps_json" "")

    local pruned
    pruned=$(prune_containers "$filtered")

    local collapsed
    collapsed=$(collapse_containers "$pruned")

    local result
    result=$(renumber_windows "$collapsed")

    # source-workspace on Safari should survive
    local source_ws
    source_ws=$(echo "$result" | jq -r '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.apple.Safari")][0]."source-workspace"')
    assert_eq "temp" "$source_ws" "source-workspace preserved through full pipeline in nested template" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.8: Empty xcodeproj — Xcode windows removed even if in app list
#---------------------------------------------------------------------------

test_2_8_empty_xcodeproj_removes_xcode() {
    log_info "Testing empty PROJECT_XCODEPROJ removes Xcode windows even if in app list"

    local template
    template=$(fixture_template_with_xcode_and_source_ws)

    # Include Xcode in apps list but provide empty xcodeproj
    local apps_json='["com.microsoft.VSCode", "com.apple.dt.Xcode", "com.apple.Safari"]'

    local result
    result=$(filter_apps "$template" "$apps_json" "")

    # Xcode should be removed despite being in the apps list
    local has_xcode
    has_xcode=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.apple.dt.Xcode")] | length')
    assert_eq "0" "$has_xcode" "Xcode removed when xcodeproj is empty" || return 1

    # Other apps should remain
    local window_count
    window_count=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window")] | length')
    assert_eq "2" "$window_count" "VSCode and Safari remain" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.9: All apps filtered — container pruning handles empty result
#---------------------------------------------------------------------------

test_2_9_all_apps_filtered() {
    log_info "Testing all apps filtered results in validation failure"

    local template
    template=$(fixture_simple_template)

    # Include no matching apps
    local apps_json='["com.nonexistent.App"]'

    local filtered
    filtered=$(filter_apps "$template" "$apps_json" "")

    local pruned
    pruned=$(prune_containers "$filtered")

    local collapsed
    collapsed=$(collapse_containers "$pruned")

    # Validate should fail (no windows)
    if validate_output "$collapsed" 2>/dev/null; then
        log_fail "validate_output should have failed with 0 windows"
        return 1
    else
        log_info "validate_output correctly rejected empty layout"
        return 0
    fi
}

#---------------------------------------------------------------------------
# Test 2.10: Window-id renumbering — sequential from 1
#---------------------------------------------------------------------------

test_2_10_window_renumbering() {
    log_info "Testing window-id renumbering is sequential from 1"

    local template
    template=$(fixture_template_with_xcode_and_source_ws)

    # Filter out Xcode (only VSCode and Safari remain with ids 1 and 3)
    local apps_json='["com.microsoft.VSCode", "com.apple.Safari"]'
    local filtered
    filtered=$(filter_apps "$template" "$apps_json" "MyApp.xcodeproj")

    local result
    result=$(renumber_windows "$filtered")

    # First window (VSCode) should have id 1
    local id1
    id1=$(echo "$result" | jq '.[0]."root-container".children[0]."window-id"')
    assert_eq "1" "$id1" "First window has id 1" || return 1

    # Second window (Safari) should have id 2
    local id2
    id2=$(echo "$result" | jq '.[0]."root-container".children[1]."window-id"')
    assert_eq "2" "$id2" "Second window has id 2" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.11: Window-id renumbering in nested containers (DFS order)
#---------------------------------------------------------------------------

test_2_11_window_renumbering_nested() {
    log_info "Testing window-id renumbering in nested containers follows DFS order"

    local template
    template=$(fixture_nested_template)

    # Keep all apps
    local apps_json='["com.apple.Safari", "com.figma.Desktop", "com.microsoft.VSCode", "com.googlecode.iterm2", "com.tinyspeck.slackmacgap", "com.brave.Browser"]'

    # Mess up the window-ids first (set them all to 99)
    local mangled
    mangled=$(echo "$template" | jq '
        [.. | select(type == "object" and .type == "window")] as $wins
        | reduce range(0; $wins | length) as $i (.; setpath(path(.. | select(type == "object" and .type == "window")) | limit(1; .[0:0]); .))
    ' 2>/dev/null || echo "$template")

    local result
    result=$(renumber_windows "$template")

    # Collect all window-ids in DFS order
    local ids
    ids=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window") | ."window-id"]')

    assert_eq "[1,2,3,4,5,6]" "$(echo "$ids" | jq -c '.')" "Window ids are sequential 1-6 in DFS order" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.12: JSON validation — output passes jq empty
#---------------------------------------------------------------------------

test_2_12_json_validation() {
    log_info "Testing generated output passes jq empty validation"

    local template
    template=$(fixture_simple_template)

    # Run full pipeline
    local subst
    subst=$(substitute_vars "$template" "testproj" "/tmp/test" "src" "tmux-test" "")

    local apps_json='["com.microsoft.VSCode", "com.googlecode.iterm2"]'
    local filtered
    filtered=$(filter_apps "$subst" "$apps_json" "")

    local pruned
    pruned=$(prune_containers "$filtered")

    local collapsed
    collapsed=$(collapse_containers "$pruned")

    local result
    result=$(renumber_windows "$collapsed")

    # Validate with jq empty
    if echo "$result" | jq empty 2>/dev/null; then
        log_info "Output passes jq empty"
    else
        log_fail "Output fails jq empty"
        return 1
    fi

    # Also use our validate_output
    if validate_output "$result"; then
        log_info "Output passes validate_output"
    else
        log_fail "Output fails validate_output"
        return 1
    fi

    return 0
}

#---------------------------------------------------------------------------
# Test 2.13: Empty iterm_cmd generates default
#---------------------------------------------------------------------------

test_2_13_empty_iterm_cmd_default() {
    log_info "Testing empty iterm_cmd gets default in generate_layout"

    # Set up template and projects.json for the full generate_layout path
    write_template "dual" "code" "$(fixture_simple_template)"

    write_projects '{
      "projects": {
        "testproj": {
          "name": "testproj",
          "dir": "/tmp/testproject",
          "subdir": "frontend",
          "iterm_cmd": "",
          "xcodeproj": "",
          "apps": ["com.microsoft.VSCode", "com.googlecode.iterm2"]
        }
      },
      "workspaces": {
        "code": { "project": "testproj", "active": true }
      }
    }'

    # Run full generation
    generate_layout "code" "dual" 2>/dev/null || {
        log_fail "generate_layout failed"
        return 1
    }

    # Read the generated file
    local output_file="$ALM_LAYOUTS_DIR/code.json"
    if [[ ! -f "$output_file" ]]; then
        log_fail "Output file not created: $output_file"
        return 1
    fi

    local iterm_startup
    iterm_startup=$(jq -r '.[0]."root-container".children[] | select(."app-bundle-id" == "com.googlecode.iterm2") | .startup' "$output_file")

    # Default should contain "cd <dir>/<subdir> && claude --dangerously-skip-permissions"
    local expected_cmd="~/nix-config/modules/darwin/scripts/iterm-window.sh 'cd /tmp/testproject/frontend && claude --dangerously-skip-permissions'"

    assert_eq "$expected_cmd" "$iterm_startup" "Default iterm_cmd generated with subdir" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.14: Empty iterm_cmd with empty subdir
#---------------------------------------------------------------------------

test_2_14_empty_iterm_cmd_no_subdir() {
    log_info "Testing empty iterm_cmd with empty subdir generates correct default"

    write_template "dual" "code" "$(fixture_simple_template)"

    write_projects '{
      "projects": {
        "testproj": {
          "name": "testproj",
          "dir": "/tmp/testproject",
          "subdir": "",
          "iterm_cmd": "",
          "xcodeproj": "",
          "apps": ["com.microsoft.VSCode", "com.googlecode.iterm2"]
        }
      },
      "workspaces": {
        "code": { "project": "testproj", "active": true }
      }
    }'

    generate_layout "code" "dual" 2>/dev/null || {
        log_fail "generate_layout failed"
        return 1
    }

    local output_file="$ALM_LAYOUTS_DIR/code.json"
    local iterm_startup
    iterm_startup=$(jq -r '.[0]."root-container".children[] | select(."app-bundle-id" == "com.googlecode.iterm2") | .startup' "$output_file")

    # No subdir — should be just "cd <dir> && claude ..."
    local expected_cmd="~/nix-config/modules/darwin/scripts/iterm-window.sh 'cd /tmp/testproject && claude --dangerously-skip-permissions'"

    assert_eq "$expected_cmd" "$iterm_startup" "Default iterm_cmd generated without subdir" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.15: Full pipeline integration — generate_layout end-to-end
#---------------------------------------------------------------------------

test_2_15_full_pipeline() {
    log_info "Testing full generate_layout pipeline end-to-end"

    write_template "dual" "code" "$(fixture_template_with_xcode_and_source_ws)"

    write_projects '{
      "projects": {
        "myapp": {
          "name": "myapp",
          "dir": "~/Projects/myapp",
          "subdir": "web",
          "iterm_cmd": "tmux-myapp",
          "xcodeproj": "",
          "apps": ["com.microsoft.VSCode", "com.apple.Safari"]
        }
      },
      "workspaces": {
        "code": { "project": "myapp", "active": true }
      }
    }'

    generate_layout "code" "dual" 2>/dev/null || {
        log_fail "generate_layout failed"
        return 1
    }

    local output_file="$ALM_LAYOUTS_DIR/code.json"
    if [[ ! -f "$output_file" ]]; then
        log_fail "Output file not created"
        return 1
    fi

    local output
    output=$(cat "$output_file")

    # Validate JSON
    if ! echo "$output" | jq empty 2>/dev/null; then
        log_fail "Output is not valid JSON"
        return 1
    fi

    # Should have 2 windows (VSCode + Safari; Xcode filtered because no xcodeproj)
    local window_count
    window_count=$(echo "$output" | jq '[.. | select(type == "object" and .type == "window")] | length')
    assert_eq "2" "$window_count" "2 windows in output (Xcode removed)" || return 1

    # VSCode startup should have substituted path (tilde expanded)
    local vscode_startup
    vscode_startup=$(echo "$output" | jq -r '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.microsoft.VSCode")][0].startup')
    # dir gets tilde-expanded in generate_layout
    echo "$vscode_startup" | grep -q "Projects/myapp/web" || {
        log_fail "VSCode startup does not contain expected path: $vscode_startup"
        return 1
    }

    # source-workspace should be preserved on Safari
    local safari_source
    safari_source=$(echo "$output" | jq -r '[.. | select(type == "object" and .type == "window" and ."app-bundle-id" == "com.apple.Safari")][0]."source-workspace"')
    assert_eq "temp" "$safari_source" "source-workspace preserved in full pipeline" || return 1

    # Window IDs should be sequential
    local ids
    ids=$(echo "$output" | jq -c '[.. | select(type == "object" and .type == "window") | ."window-id"]')
    assert_eq "[1,2]" "$ids" "Window IDs sequential from 1" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.16: Cascading container prune
#---------------------------------------------------------------------------

test_2_16_cascading_prune() {
    log_info "Testing cascading container prune — nested empty containers"

    # A structure where filtering creates a cascade:
    # root-container -> container A -> container B -> window (filtered out)
    local template
    template='[{
      "name": "test",
      "type": "workspace",
      "root-container": {
        "type": "container",
        "layout": "h_tiles",
        "orientation": "horizontal",
        "children": [
          {
            "type": "container",
            "layout": "v_accordion",
            "orientation": "vertical",
            "children": [
              {
                "type": "container",
                "layout": "h_accordion",
                "orientation": "horizontal",
                "children": [
                  {
                    "type": "window",
                    "app-bundle-id": "com.removed.App",
                    "app-name": "Removed",
                    "title": "",
                    "window-id": 1,
                    "startup": "echo removed"
                  }
                ]
              }
            ]
          },
          {
            "type": "window",
            "app-bundle-id": "com.kept.App",
            "app-name": "Kept",
            "title": "",
            "window-id": 2,
            "startup": "echo kept"
          }
        ]
      }
    }]'

    local apps_json='["com.kept.App"]'
    local filtered
    filtered=$(filter_apps "$template" "$apps_json" "")

    local pruned
    pruned=$(prune_containers "$filtered")

    # After cascading prune, only the kept window should remain
    local container_count
    container_count=$(echo "$pruned" | jq '[.. | select(type == "object" and .type == "container")] | length')
    assert_eq "1" "$container_count" "Only root container remains after cascading prune" || return 1

    local window_count
    window_count=$(echo "$pruned" | jq '[.. | select(type == "object" and .type == "window")] | length')
    assert_eq "1" "$window_count" "Only kept window remains" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.17: Collapse does NOT collapse single-child-window containers
#---------------------------------------------------------------------------

test_2_17_collapse_preserves_single_window() {
    log_info "Testing collapse does not promote a single window child"

    # Root has one container child that has one window — should NOT collapse
    # (collapse only applies when single child is a container)
    local template='[{
      "name": "test",
      "type": "workspace",
      "root-container": {
        "type": "container",
        "layout": "h_tiles",
        "orientation": "horizontal",
        "children": [
          {
            "type": "container",
            "layout": "v_accordion",
            "orientation": "vertical",
            "children": [
              {
                "type": "window",
                "app-bundle-id": "com.test.App",
                "app-name": "Test",
                "title": "",
                "window-id": 1,
                "startup": "echo test"
              }
            ]
          }
        ]
      }
    }]'

    local result
    result=$(collapse_containers "$template")

    # Root should still be h_tiles (NOT collapsed because child is a container
    # with a single WINDOW child, not a single CONTAINER child)
    # Actually: root has 1 child that IS a container — so the container SHOULD
    # be promoted. The rule is "1 child that is also a container" gets promoted.
    local root_layout
    root_layout=$(echo "$result" | jq -r '.[0]."root-container".layout')
    assert_eq "v_accordion" "$root_layout" "Single container child promoted" || return 1

    # The promoted container should have 1 window child
    local child_type
    child_type=$(echo "$result" | jq -r '.[0]."root-container".children[0].type')
    assert_eq "window" "$child_type" "Promoted container has window child" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test 2.18: Collapse stops at single-window leaf
#---------------------------------------------------------------------------

test_2_18_collapse_stops_at_window() {
    log_info "Testing collapse stabilizes with single window in container"

    # After all container promotions, we should end with a container holding a window
    local template='[{
      "name": "test",
      "type": "workspace",
      "root-container": {
        "type": "container",
        "layout": "h_tiles",
        "orientation": "horizontal",
        "children": [
          {
            "type": "container",
            "layout": "v_accordion",
            "orientation": "vertical",
            "children": [
              {
                "type": "container",
                "layout": "h_accordion",
                "orientation": "horizontal",
                "children": [
                  {
                    "type": "window",
                    "app-bundle-id": "com.test.App",
                    "app-name": "Test",
                    "title": "",
                    "window-id": 1,
                    "startup": "echo test"
                  }
                ]
              }
            ]
          }
        ]
      }
    }]'

    local result
    result=$(collapse_containers "$template")

    # Should collapse through both levels: root gets the innermost container's layout
    local root_layout
    root_layout=$(echo "$result" | jq -r '.[0]."root-container".layout')
    assert_eq "h_accordion" "$root_layout" "Deeply nested container collapsed to root" || return 1

    # Should have exactly 1 window
    local window_count
    window_count=$(echo "$result" | jq '[.. | select(type == "object" and .type == "window")] | length')
    assert_eq "1" "$window_count" "Single window preserved" || return 1

    # Total containers should be just 1 (root)
    local container_count
    container_count=$(echo "$result" | jq '[.. | select(type == "object" and .type == "container")] | length')
    assert_eq "1" "$container_count" "Only root container after deep collapse" || return 1

    return 0
}

#---------------------------------------------------------------------------
# Test Registry
#---------------------------------------------------------------------------

declare -A TESTS
TESTS["2.1"]="test_2_1_variable_substitution:Variable substitution (all PROJECT_* vars)"
TESTS["2.2"]="test_2_2_empty_subdir_no_trailing_slash:Empty PROJECT_SUBDIR — no trailing slash"
TESTS["2.3"]="test_2_3_app_filtering:App filtering removes non-included apps"
TESTS["2.4"]="test_2_4_container_pruning:Container pruning removes empty containers"
TESTS["2.5"]="test_2_5_container_collapse:Container collapse promotes single container child"
TESTS["2.6"]="test_2_6_field_preservation:Field preservation (source-workspace) through pipeline"
TESTS["2.7"]="test_2_7_field_preservation_nested:Field preservation in nested containers"
TESTS["2.8"]="test_2_8_empty_xcodeproj_removes_xcode:Empty xcodeproj removes Xcode windows"
TESTS["2.9"]="test_2_9_all_apps_filtered:All apps filtered — validation rejects empty"
TESTS["2.10"]="test_2_10_window_renumbering:Window-id renumbering sequential from 1"
TESTS["2.11"]="test_2_11_window_renumbering_nested:Window-id renumbering in nested (DFS order)"
TESTS["2.12"]="test_2_12_json_validation:JSON validation — output passes jq empty"
TESTS["2.13"]="test_2_13_empty_iterm_cmd_default:Empty iterm_cmd generates default (with subdir)"
TESTS["2.14"]="test_2_14_empty_iterm_cmd_no_subdir:Empty iterm_cmd generates default (no subdir)"
TESTS["2.15"]="test_2_15_full_pipeline:Full pipeline integration — generate_layout end-to-end"
TESTS["2.16"]="test_2_16_cascading_prune:Cascading container prune"
TESTS["2.17"]="test_2_17_collapse_preserves_single_window:Collapse promotes container, preserves window"
TESTS["2.18"]="test_2_18_collapse_stops_at_window:Collapse stabilizes through deep nesting"

list_tests() {
    echo "Available tests:"
    for id in $(echo "${!TESTS[@]}" | tr ' ' '\n' | sort -V); do
        local info="${TESTS[$id]}"
        local name="${info#*:}"
        echo "  $id: $name"
    done
}

run_single_test() {
    local test_id="$1"
    if [[ -z "${TESTS[$test_id]:-}" ]]; then
        log_fail "Unknown test: $test_id"
        list_tests
        exit 1
    fi

    local info="${TESTS[$test_id]}"
    local func="${info%%:*}"
    local name="${info#*:}"

    run_test "$test_id" "$name" "$func"
}

run_all_tests() {
    log_info "Running all generation module tests..."
    echo ""

    for id in $(echo "${!TESTS[@]}" | tr ' ' '\n' | sort -V); do
        run_single_test "$id" || true  # Continue on failure
    done

    echo ""
    echo "=============================================="
    echo "SUMMARY"
    echo "=============================================="
    echo "Tests run:    $TESTS_RUN"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo ""

    # Clean up
    teardown_test_env

    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

#---------------------------------------------------------------------------
# Main
#---------------------------------------------------------------------------

main() {
    if [[ $# -eq 0 ]]; then
        run_all_tests
    elif [[ "$1" == "--list" ]] || [[ "$1" == "-l" ]]; then
        list_tests
    elif [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        echo "Usage: $0 [test-id|--list|--help]"
        echo ""
        echo "Options:"
        echo "  test-id   Run specific test (e.g., 2.1)"
        echo "  --list    List available tests"
        echo "  --help    Show this help"
        echo ""
        echo "Environment:"
        echo "  VERBOSE   Enable verbose output (default: false)"
    else
        setup_test_env
        run_single_test "$1"
        teardown_test_env
    fi
}

main "$@"
