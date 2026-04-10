#!/usr/bin/env bash
#
# Complex Layout Integration Tests for aerospace-layout-manager
#
# Tests ALM's end-to-end layout reconstruction using fixture JSONs.
# For each fixture: provision iTerm2 windows, create dynamic mapping,
# run ALM, query aerospace tree, compare against expected structure.
#
# Usage:
#   ./tests/complex-layout-tests.sh              # Run all tests
#   ./tests/complex-layout-tests.sh 2.1          # Run specific test
#   ./tests/complex-layout-tests.sh --list       # List available tests
#   ./tests/complex-layout-tests.sh --verbose    # Verbose output
#   VERBOSE=true ./tests/complex-layout-tests.sh # Same as --verbose
#
# Environment:
#   TEST_WS        Workspace for testing (default: t)
#   VERBOSE        Enable verbose output (default: false)
#   POLL_TIMEOUT   Timeout for window provisioning in seconds (default: 10)
#

set -euo pipefail

#---------------------------------------------------------------------------
# Initialization
#---------------------------------------------------------------------------

# Resolve script location (handles symlinks)
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"

# Source shared test helpers
source "$SCRIPT_DIR/test-helpers.sh"

# ALM binary
ALM_BIN="$TEST_REPO_ROOT/bin/aerospace-layout-manager"

# Fixtures directory
FIXTURES_DIR="$SCRIPT_DIR/fixtures"

# Temp directory for dynamic fixture files
TEST_TMP=""

#---------------------------------------------------------------------------
# Suite Setup / Teardown
#---------------------------------------------------------------------------

# Maximum number of windows needed across all fixtures.
# large-container needs 6, two-sibling-containers needs 5,
# flat-5-windows needs 5. We provision the max to reuse across tests.
MAX_WINDOWS=6

# Track whether suite_setup ran (to skip teardown for --list/--help)
_SUITE_INITIALIZED=false

suite_setup() {
    log_info "=== Complex Layout Integration Test Suite ==="
    log_info "ALM binary: $ALM_BIN"
    log_info "Fixtures:   $FIXTURES_DIR"
    log_info "Workspace:  $TEST_WS"
    echo ""

    # Verify ALM binary exists
    if [[ ! -x "$ALM_BIN" ]]; then
        log_fail "ALM binary not found or not executable: $ALM_BIN"
        exit 1
    fi

    # Verify fixtures directory exists
    if [[ ! -d "$FIXTURES_DIR" ]]; then
        log_fail "Fixtures directory not found: $FIXTURES_DIR"
        exit 1
    fi

    # Create temp directory for dynamic fixtures
    TEST_TMP=$(mktemp -d)
    log_verbose "Temp directory: $TEST_TMP"

    # Verify test workspace is empty
    assert_workspace_empty || exit 1

    # Provision test windows
    log_info "Provisioning $MAX_WINDOWS iTerm2 windows..."
    provision_test_windows "$MAX_WINDOWS" || {
        log_fail "Failed to provision test windows"
        exit 1
    }

    _SUITE_INITIALIZED=true
    log_info "Suite setup complete"
    echo ""
}

suite_teardown() {
    # Skip teardown if suite was never initialized (e.g., --list, --help)
    if [[ "$_SUITE_INITIALIZED" != "true" ]]; then
        return 0
    fi

    echo ""
    log_info "=== Suite Teardown ==="

    # Close all provisioned windows
    cleanup_test_windows

    # Reset workspace
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true

    # Clean up temp directory
    if [[ -n "$TEST_TMP" ]] && [[ -d "$TEST_TMP" ]]; then
        rm -rf "$TEST_TMP"
        log_verbose "Cleaned up temp directory"
    fi

    log_info "Suite teardown complete"
}

# Register teardown trap
trap suite_teardown EXIT

#---------------------------------------------------------------------------
# Dynamic Fixture Generation
#---------------------------------------------------------------------------

# Count the total number of windows in a fixture JSON.
# Usage: count_fixture_windows fixture.json
count_fixture_windows() {
    local fixture_file="$1"
    jq '[.. | objects | select(.type == "window")] | length' < "$fixture_file"
}

# Create a dynamic fixture JSON by replacing synthetic window-ids with real
# provisioned window IDs. The mapping is positional: fixture window-id 1 maps
# to the first provisioned window, window-id 2 to the second, etc.
#
# Usage: create_dynamic_fixture <fixture_file> <output_file> <window_ids...>
# The fixture workspace name is also replaced with $TEST_WS.
create_dynamic_fixture() {
    local fixture_file="$1"
    local output_file="$2"
    shift 2
    local window_ids=("$@")

    # Build a jq mapping object: {"1": "real_id_1", "2": "real_id_2", ...}
    local mapping_json="{"
    local idx=1
    for wid in "${window_ids[@]}"; do
        if [[ $idx -gt 1 ]]; then
            mapping_json+=","
        fi
        mapping_json+="\"$idx\":\"$wid\""
        ((idx++))
    done
    mapping_json+="}"

    log_verbose "Window ID mapping: $mapping_json"

    # Replace window-ids in the fixture and update workspace name and titles
    jq --argjson mapping "$mapping_json" --arg ws "$TEST_WS" '
        # Recursively walk and replace window-ids and workspace name
        def remap:
            if type == "object" then
                if .type == "workspace" then
                    .name = $ws | .["root-container"] = (."root-container" | remap)
                elif .type == "container" then
                    .children = [.children[] | remap]
                elif .type == "window" then
                    . as $w |
                    ($w["window-id"] | tostring) as $old_id |
                    if $mapping[$old_id] then
                        $w + {"window-id": ($mapping[$old_id] | tonumber)}
                    else
                        $w
                    end
                else .
                end
            elif type == "array" then
                [.[] | remap]
            else .
            end;

        remap
    ' < "$fixture_file" > "$output_file"

    log_verbose "Dynamic fixture written to $output_file"
}

#---------------------------------------------------------------------------
# Test Execution Helper
#---------------------------------------------------------------------------

# Run a single fixture test.
# Handles: reset workspace, create dynamic fixture, run ALM, compare tree.
#
# Arguments:
#   $1 - fixture filename (without path, e.g., "flat-3-windows.json")
#   $2 - number of windows needed
#
# Returns 0 on pass, 1 on fail.
run_fixture_test() {
    local fixture_name="$1"
    local window_count="$2"
    local fixture_file="$FIXTURES_DIR/$fixture_name"
    local dynamic_file="$TEST_TMP/dynamic-$fixture_name"

    # Verify fixture exists
    if [[ ! -f "$fixture_file" ]]; then
        log_fail "Fixture not found: $fixture_file"
        return 1
    fi

    # Select the needed number of provisioned windows
    local selected_ids=("${_PROVISIONED_WINDOW_IDS[@]:0:$window_count}")
    if [[ ${#selected_ids[@]} -lt $window_count ]]; then
        log_fail "Not enough provisioned windows: need $window_count, have ${#_PROVISIONED_WINDOW_IDS[@]}"
        return 1
    fi

    log_verbose "Using windows: ${selected_ids[*]}"

    # Ensure all selected windows are in the test workspace and tree is flat
    reset_test_workspace
    for wid in "${selected_ids[@]}"; do
        aerospace move-node-to-workspace --window-id "$wid" "$TEST_WS" 2>/dev/null || true
    done
    aerospace workspace "$TEST_WS"
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true
    sleep 0.3

    # Create dynamic fixture with real window IDs
    create_dynamic_fixture "$fixture_file" "$dynamic_file" "${selected_ids[@]}"

    log_verbose "Running ALM: $ALM_BIN --allow-missing $TEST_WS $dynamic_file"

    # Run ALM
    local alm_output
    alm_output=$("$ALM_BIN" --allow-missing "$TEST_WS" "$dynamic_file" 2>&1) || {
        log_fail "ALM exited with error"
        if [[ "$VERBOSE" == "true" ]]; then
            echo "$alm_output"
        fi
        return 1
    }

    if [[ "$VERBOSE" == "true" ]]; then
        echo "$alm_output"
    fi

    # Let aerospace settle
    sleep 0.5

    # Query actual tree
    local actual_tree
    actual_tree=$(get_workspace_tree "$TEST_WS")

    if [[ -z "$actual_tree" ]] || [[ "$actual_tree" == "null" ]]; then
        log_fail "Failed to get workspace tree"
        return 1
    fi

    log_verbose "Actual tree:"
    if [[ "$VERBOSE" == "true" ]]; then
        dump_tree_summary
    fi

    # Pre-normalize the fixture so the expected structure accounts for
    # AeroSpace normalization rules (orientation flips, single-child flattening)
    local normalize_script="$TEST_REPO_ROOT/lib/json/normalize.sh"
    local normalized_fixture
    normalized_fixture=$(jq -c '.[0]."root-container"' < "$fixture_file" | \
        bash -c 'debug() { :; }; source "'"$normalize_script"'"; read -r rc; normalize_layout_tree "$rc"')
    # Rebuild the full fixture structure with the normalized root-container
    local normalized_expected
    normalized_expected=$(jq -c --argjson rc "$normalized_fixture" '.[0] | .["root-container"] = $rc | [.]' < "$fixture_file")

    # Compare against expected structure (derived from the normalized fixture)
    compare_tree_structure "$normalized_expected" "$actual_tree"
}

#---------------------------------------------------------------------------
# Test Functions
#---------------------------------------------------------------------------

test_2_1_flat_3_windows() {
    # Baseline: 3 windows in a flat h_accordion layout
    log_info "Fixture: flat-3-windows.json (3 windows, no nesting)"
    run_fixture_test "flat-3-windows.json" 3
}

test_2_2_flat_5_windows() {
    # Baseline: 5 windows in a flat v_tiles layout
    log_info "Fixture: flat-5-windows.json (5 windows, no nesting)"
    run_fixture_test "flat-5-windows.json" 5
}

test_2_3_two_sibling_containers() {
    # The code2 case: h_accordion root with v_accordion[3] + v_accordion[2]
    log_info "Fixture: two-sibling-containers.json (h_accordion root, 2 child containers)"
    run_fixture_test "two-sibling-containers.json" 5
}

test_2_4_mixed_children() {
    # Root with 1 direct window + 1 container[2 windows]
    log_info "Fixture: mixed-children.json (1 window + 1 container as siblings)"
    run_fixture_test "mixed-children.json" 3
}

test_2_5_different_layout_types() {
    # h_tiles root with v_accordion[2] + v_tiles[2]
    log_info "Fixture: different-layout-types.json (h_tiles root, different child layouts)"
    run_fixture_test "different-layout-types.json" 4
}

test_2_6_large_container() {
    # Single nested container with 6 windows
    log_info "Fixture: large-container.json (1 container with 6 windows)"
    run_fixture_test "large-container.json" 6
}

#---------------------------------------------------------------------------
# T8: Regression Tests for Flat Layouts
#
# These tests verify that existing flat layout patterns (code.json, daily.json,
# work.json, brave.json, messages.json) continue to work correctly after the
# Phase 1 and pre-normalization changes. Each fixture mirrors a real layout's
# structure and layout type.
#---------------------------------------------------------------------------

test_3_1_flat_code_pattern() {
    # code.json pattern: h_accordion with 6 flat windows (real code.json has 8,
    # capped at 6 to stay within provisioned window limit)
    log_info "Fixture: flat-code-pattern.json (h_accordion, 6 windows — code.json pattern)"
    run_fixture_test "flat-code-pattern.json" 6
}

test_3_2_flat_daily_pattern() {
    # daily.json pattern: h_accordion with 4 flat windows
    log_info "Fixture: flat-daily-pattern.json (h_accordion, 4 windows — daily.json pattern)"
    run_fixture_test "flat-daily-pattern.json" 4
}

test_3_3_flat_work_pattern() {
    # work.json pattern: h_accordion with 2 flat windows
    log_info "Fixture: flat-work-pattern.json (h_accordion, 2 windows — work.json pattern)"
    run_fixture_test "flat-work-pattern.json" 2
}

test_3_4_flat_brave_pattern() {
    # brave.json pattern: v_accordion with 2 flat windows
    log_info "Fixture: flat-brave-pattern.json (v_accordion, 2 windows — brave.json pattern)"
    run_fixture_test "flat-brave-pattern.json" 2
}

test_3_5_flat_messages_pattern() {
    # messages.json pattern: v_tiles with 3 flat windows
    log_info "Fixture: flat-messages-pattern.json (v_tiles, 3 windows — messages.json pattern)"
    run_fixture_test "flat-messages-pattern.json" 3
}

test_3_6_normalization_invariance() {
    # Verify that pre-normalization does NOT alter already-correct flat layouts.
    # Runs normalize_layout_tree on each flat fixture and compares input vs output.
    # This is a unit-style check (no ALM run needed, no windows needed).
    log_info "Normalization invariance: flat layouts should pass through unchanged"

    local normalize_script="$TEST_REPO_ROOT/lib/json/normalize.sh"
    if [[ ! -f "$normalize_script" ]]; then
        log_fail "normalize.sh not found at $normalize_script"
        return 1
    fi

    local all_pass=true
    local flat_fixtures=(
        "flat-3-windows.json"
        "flat-5-windows.json"
        "flat-code-pattern.json"
        "flat-daily-pattern.json"
        "flat-work-pattern.json"
        "flat-brave-pattern.json"
        "flat-messages-pattern.json"
    )

    for fixture_name in "${flat_fixtures[@]}"; do
        local fixture_file="$FIXTURES_DIR/$fixture_name"
        if [[ ! -f "$fixture_file" ]]; then
            log_fail "  Fixture not found: $fixture_name"
            all_pass=false
            continue
        fi

        # Extract root-container from fixture
        local root_container
        root_container=$(jq -c '.[0]."root-container"' < "$fixture_file")

        # Run normalization in a subshell that sources the normalize script
        # We need to provide a stub debug function since normalize.sh calls debug()
        local normalized
        normalized=$(bash -c '
            debug() { :; }
            source "'"$normalize_script"'"
            normalize_layout_tree "$1"
        ' -- "$root_container")

        # Compare: strip whitespace differences by normalizing both through jq -S
        local input_norm output_norm
        input_norm=$(echo "$root_container" | jq -S '.')
        output_norm=$(echo "$normalized" | jq -S '.')

        if [[ "$input_norm" == "$output_norm" ]]; then
            log_verbose "  $fixture_name: unchanged (correct)"
        else
            log_fail "  $fixture_name: normalization ALTERED the layout!"
            log_fail "    Input:  $input_norm"
            log_fail "    Output: $output_norm"
            all_pass=false
        fi
    done

    if [[ "$all_pass" == "true" ]]; then
        log_pass "All flat fixtures pass through normalization unchanged"
        return 0
    else
        return 1
    fi
}

#---------------------------------------------------------------------------
# Test Registry
#---------------------------------------------------------------------------

declare -A TESTS
TESTS["2.1"]="test_2_1_flat_3_windows:Flat layout - 3 windows (h_accordion)"
TESTS["2.2"]="test_2_2_flat_5_windows:Flat layout - 5 windows (v_tiles)"
TESTS["2.3"]="test_2_3_two_sibling_containers:Two sibling containers (code2 pattern)"
TESTS["2.4"]="test_2_4_mixed_children:Mixed children (window + container)"
TESTS["2.5"]="test_2_5_different_layout_types:Different layout types per container"
TESTS["2.6"]="test_2_6_large_container:Large single nested container (6 windows)"
TESTS["3.1"]="test_3_1_flat_code_pattern:Regression - flat code.json pattern (h_accordion, 6 windows)"
TESTS["3.2"]="test_3_2_flat_daily_pattern:Regression - flat daily.json pattern (h_accordion, 4 windows)"
TESTS["3.3"]="test_3_3_flat_work_pattern:Regression - flat work.json pattern (h_accordion, 2 windows)"
TESTS["3.4"]="test_3_4_flat_brave_pattern:Regression - flat brave.json pattern (v_accordion, 2 windows)"
TESTS["3.5"]="test_3_5_flat_messages_pattern:Regression - flat messages.json pattern (v_tiles, 3 windows)"
TESTS["3.6"]="test_3_6_normalization_invariance:Regression - pre-normalization leaves flat layouts unchanged"

#---------------------------------------------------------------------------
# CLI Handling
#---------------------------------------------------------------------------

main() {
    # Parse --verbose flag before anything else
    local args=()
    for arg in "$@"; do
        if [[ "$arg" == "--verbose" ]] || [[ "$arg" == "-v" ]]; then
            VERBOSE="true"
        else
            args+=("$arg")
        fi
    done
    set -- "${args[@]+"${args[@]}"}"

    # Handle --list and --help without provisioning windows
    if [[ $# -gt 0 ]]; then
        if [[ "$1" == "--list" ]] || [[ "$1" == "-l" ]]; then
            list_tests_from_registry
            exit 0
        elif [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
            echo "Usage: $0 [OPTIONS] [test-id]"
            echo ""
            echo "Options:"
            echo "  test-id      Run specific test (e.g., 2.1, 2.3)"
            echo "  --list, -l   List available tests"
            echo "  --verbose,-v Enable verbose output"
            echo "  --help, -h   Show this help"
            echo ""
            echo "Environment:"
            echo "  TEST_WS      Workspace to use (default: t)"
            echo "  VERBOSE      Enable verbose output (default: false)"
            echo "  POLL_TIMEOUT Timeout for window provisioning (default: 10)"
            echo ""
            echo "Tests compare ALM's output tree against expected fixture structure."
            echo "Each test provisions its own iTerm2 windows and cleans up after."
            exit 0
        fi
    fi

    # Run suite setup (provisions windows)
    suite_setup

    # Dispatch to test runner
    if [[ $# -eq 0 ]]; then
        run_all_tests_from_registry
    else
        run_single_test_from_registry "$1"
        print_test_summary
    fi

    # Exit with failure code if any tests failed
    if [[ $TESTS_FAILED -gt 0 ]]; then
        exit 1
    fi
}

main "$@"
