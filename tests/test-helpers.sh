#!/usr/bin/env bash
#
# Test Helper Library for aerospace-layout-manager tests
#
# Provides shared utilities extracted from aerospace-layout-tests.sh plus
# new functions for tree comparison, window provisioning, and teardown.
#
# Usage: source this file from test scripts
#   source "$(dirname "${BASH_SOURCE[0]}")/test-helpers.sh"
#
# Environment:
#   TEST_WS      Workspace for testing (default: t)
#   VERBOSE       Enable verbose output (default: false)
#   POLL_INTERVAL Polling interval in seconds for window provisioning (default: 0.2)
#   POLL_TIMEOUT  Timeout in seconds for window provisioning (default: 10)
#

# Prevent double-sourcing
[[ -n "${_TEST_HELPERS_LOADED:-}" ]] && return 0
_TEST_HELPERS_LOADED=1

set -euo pipefail

#---------------------------------------------------------------------------
# Configuration
#---------------------------------------------------------------------------

TEST_WS="${TEST_WS:-t}"
VERBOSE="${VERBOSE:-false}"
POLL_INTERVAL="${POLL_INTERVAL:-0.2}"
POLL_TIMEOUT="${POLL_TIMEOUT:-10}"

# Resolve directories
_TEST_HELPERS_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
TEST_REPO_ROOT="$(cd "$_TEST_HELPERS_DIR/.." && pwd)"

# Track provisioned window IDs for cleanup
_PROVISIONED_WINDOW_IDS=()

#---------------------------------------------------------------------------
# Colors
#---------------------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

#---------------------------------------------------------------------------
# Logging
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
        echo -e "${CYAN}[VERB]${NC} $*"
    fi
}

#---------------------------------------------------------------------------
# Test Runner Framework
#---------------------------------------------------------------------------

# Test tracking counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Run a single test with setup/teardown
# Usage: run_test <test_id> <test_name> <test_function>
run_test() {
    local test_id="$1"
    local test_name="$2"
    local test_func="$3"

    echo ""
    echo "=============================================="
    echo "Test $test_id: $test_name"
    echo "=============================================="

    TESTS_RUN=$((TESTS_RUN + 1))

    # Reset workspace before each test
    reset_test_workspace

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

# Print test summary
print_test_summary() {
    echo ""
    echo "=============================================="
    echo "SUMMARY"
    echo "=============================================="
    echo "Tests run:    $TESTS_RUN"
    echo -e "Tests passed: ${GREEN}$TESTS_PASSED${NC}"
    echo -e "Tests failed: ${RED}$TESTS_FAILED${NC}"
    echo ""
}

# List tests from an associative array
# Usage: list_tests_from_registry (reads from TESTS associative array)
list_tests_from_registry() {
    echo "Available tests:"
    for id in $(echo "${!TESTS[@]}" | tr ' ' '\n' | sort); do
        local info="${TESTS[$id]}"
        local name="${info#*:}"
        echo "  $id: $name"
    done
}

# Run a single test by ID from the registry
# Usage: run_single_test_from_registry <test_id>
run_single_test_from_registry() {
    local test_id="$1"
    if [[ -z "${TESTS[$test_id]:-}" ]]; then
        log_fail "Unknown test: $test_id"
        list_tests_from_registry
        exit 1
    fi

    local info="${TESTS[$test_id]}"
    local func="${info%%:*}"
    local name="${info#*:}"

    run_test "$test_id" "$name" "$func"
}

# Run all tests from the registry
# Usage: run_all_tests_from_registry
run_all_tests_from_registry() {
    for id in $(echo "${!TESTS[@]}" | tr ' ' '\n' | sort); do
        run_single_test_from_registry "$id" || true  # Continue on failure
    done
    print_test_summary
}

# Standard CLI handler for test scripts
# Usage: handle_test_cli "$@"
# Expects TESTS associative array to be declared in the caller
handle_test_cli() {
    if [[ $# -eq 0 ]]; then
        run_all_tests_from_registry
    elif [[ "$1" == "--list" ]] || [[ "$1" == "-l" ]]; then
        list_tests_from_registry
    elif [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
        echo "Usage: $0 [test-id|--list|--help|--verbose]"
        echo ""
        echo "Options:"
        echo "  test-id    Run specific test (e.g., 1.1)"
        echo "  --list     List available tests"
        echo "  --help     Show this help"
        echo ""
        echo "Environment:"
        echo "  TEST_WS    Workspace to use (default: t)"
        echo "  VERBOSE    Enable verbose output (default: false)"
    else
        run_single_test_from_registry "$1"
    fi
}

#---------------------------------------------------------------------------
# Tree Query Functions
#---------------------------------------------------------------------------

# Get current workspace tree as JSON
get_tree() {
    aerospace tree --json --workspace "$TEST_WS" 2>/dev/null
}

# Get tree for a specific workspace
get_workspace_tree() {
    local ws="${1:-$TEST_WS}"
    aerospace tree --json --workspace "$ws" 2>/dev/null
}

# Pretty print tree for debugging
print_tree() {
    log_info "Current tree structure:"
    get_workspace_tree | jq -r '.' 2>/dev/null || echo "Failed to get tree"
}

# Get the root container layout from tree output
get_root_layout() {
    get_workspace_tree | jq -r '.[0]."root-container".layout // "unknown"' 2>/dev/null
}

# Find a window in the tree and return its parent container info
# Returns: layout|children_count
find_window_parent() {
    local window_id="$1"
    local tree
    tree=$(get_workspace_tree)

    echo "$tree" | jq -r --arg wid "$window_id" '
        def find_parent:
            if type == "object" then
                if .type == "workspace" then
                    ."root-container" | find_parent
                elif .type == "container" then
                    if (.children // []) | any(.type == "window" and (."window-id" | tostring) == $wid) then
                        {layout: .layout, children_count: (.children | length), found: true}
                    else
                        (.children // []) | map(select(.type == "container")) | map(find_parent) | map(select(.found == true)) | first // {found: false}
                    end
                else
                    {found: false}
                end
            elif type == "array" then
                map(find_parent) | map(select(.found == true)) | first // {found: false}
            else
                {found: false}
            end;

        .[0] | find_parent | if .found then "\(.layout)|\(.children_count)" else "not_found|0" end
    ' 2>/dev/null || echo "error|0"
}

# Get the full tree structure in a readable format
dump_tree_summary() {
    local tree
    tree=$(get_workspace_tree)

    echo "$tree" | jq -r '
        def summarize(depth):
            (("  " * depth) +
            (if .type == "workspace" then
                "workspace: \(.name)\n" + (."root-container" | summarize(depth + 1))
            elif .type == "container" then
                "container(\(.layout)):\n" + ((.children // []) | map(summarize(depth + 1)) | join(""))
            elif .type == "window" then
                "window(\(."window-id")): \(."app-name")\n"
            else
                "unknown\n"
            end));

        .[0] | summarize(0)
    ' 2>/dev/null || echo "Failed to summarize tree"
}

# Get window IDs in workspace
get_window_ids() {
    aerospace list-windows --workspace "$TEST_WS" --format '%{window-id}' 2>/dev/null
}

# Count windows in workspace
count_windows() {
    get_window_ids | wc -l | tr -d ' '
}

# Get currently focused window ID
get_focused_window() {
    aerospace list-windows --focused --format '%{window-id}' 2>/dev/null
}

#---------------------------------------------------------------------------
# Tree Structure Extraction & Comparison
# (moved to lib/diff/tree_compare.sh — source it here so log_fail / log_verbose
#  defined above take precedence over the fallbacks)
#---------------------------------------------------------------------------

source "$TEST_REPO_ROOT/lib/diff/tree_compare.sh"

#---------------------------------------------------------------------------
# Window Provisioning
#---------------------------------------------------------------------------

# Spawn iTerm2 windows and return their aerospace window IDs.
# Windows are moved to the test workspace.
#
# Usage: provision_test_windows <count>
# Sets: _PROVISIONED_WINDOW_IDS array with the new window IDs
# Returns 0 on success, 1 if not enough windows appeared within timeout.
provision_test_windows() {
    local count="${1:?Usage: provision_test_windows <count>}"
    _PROVISIONED_WINDOW_IDS=()

    # Record existing window IDs before spawning
    local before_ids
    before_ids=$(aerospace list-windows --all --format '%{window-id}' 2>/dev/null | sort -n)

    log_info "Provisioning $count iTerm2 test windows..."

    # Spawn windows
    for ((i = 0; i < count; i++)); do
        osascript -e 'tell application "iTerm2" to create window with default profile' >/dev/null 2>&1
        # Small stagger to avoid race conditions
        sleep 0.3
    done

    # Poll until we see the new windows
    local elapsed=0
    local new_ids=()

    while (( $(echo "$elapsed < $POLL_TIMEOUT" | bc -l) )); do
        local current_ids
        current_ids=$(aerospace list-windows --all --format '%{window-id}' 2>/dev/null | sort -n)

        # Find new IDs (present in current but not in before)
        new_ids=()
        while IFS= read -r wid; do
            [[ -z "$wid" ]] && continue
            if ! echo "$before_ids" | grep -qx "$wid"; then
                new_ids+=("$wid")
            fi
        done <<< "$current_ids"

        if [[ ${#new_ids[@]} -ge $count ]]; then
            break
        fi

        sleep "$POLL_INTERVAL"
        elapsed=$(echo "$elapsed + $POLL_INTERVAL" | bc -l)
    done

    if [[ ${#new_ids[@]} -lt $count ]]; then
        log_fail "Timeout: only ${#new_ids[@]} of $count windows appeared after ${POLL_TIMEOUT}s"
        # Still track what we got for cleanup
        _PROVISIONED_WINDOW_IDS=("${new_ids[@]}")
        return 1
    fi

    # Take exactly the number requested (in case extras appeared)
    _PROVISIONED_WINDOW_IDS=("${new_ids[@]:0:$count}")

    log_info "Provisioned ${#_PROVISIONED_WINDOW_IDS[@]} windows: ${_PROVISIONED_WINDOW_IDS[*]}"

    # Move all provisioned windows to the test workspace
    for wid in "${_PROVISIONED_WINDOW_IDS[@]}"; do
        aerospace move-node-to-workspace --window-id "$wid" "$TEST_WS" 2>/dev/null || {
            log_warn "Failed to move window $wid to workspace $TEST_WS"
        }
    done

    # Focus the test workspace and let things settle
    aerospace workspace "$TEST_WS"
    sleep 0.3

    log_info "All provisioned windows moved to workspace $TEST_WS"
    return 0
}

# Get the array of provisioned window IDs (for use after provision_test_windows)
get_provisioned_window_ids() {
    echo "${_PROVISIONED_WINDOW_IDS[@]}"
}

#---------------------------------------------------------------------------
# Teardown
#---------------------------------------------------------------------------

# Close all windows that were spawned by provision_test_windows.
# Uses aerospace close to close each tracked window.
cleanup_test_windows() {
    if [[ ${#_PROVISIONED_WINDOW_IDS[@]} -eq 0 ]]; then
        log_verbose "No provisioned windows to clean up"
        return 0
    fi

    log_info "Cleaning up ${#_PROVISIONED_WINDOW_IDS[@]} provisioned windows..."

    local closed=0
    for wid in "${_PROVISIONED_WINDOW_IDS[@]}"; do
        if aerospace close --window-id "$wid" 2>/dev/null; then
            log_verbose "Closed window $wid"
            ((closed++))
        else
            log_warn "Failed to close window $wid (may already be closed)"
        fi
    done

    log_info "Closed $closed of ${#_PROVISIONED_WINDOW_IDS[@]} windows"
    _PROVISIONED_WINDOW_IDS=()
}

#---------------------------------------------------------------------------
# Workspace Safety
#---------------------------------------------------------------------------

# Verify the test workspace is empty before running tests.
# If windows are present, warn and abort to avoid interfering with
# the user's real windows.
#
# Usage: assert_workspace_empty
# Returns 0 if empty, 1 if occupied (and prints a warning).
assert_workspace_empty() {
    local window_count
    window_count=$(aerospace list-windows --workspace "$TEST_WS" --format '%{window-id}' 2>/dev/null | grep -c . || true)

    if [[ "$window_count" -gt 0 ]]; then
        log_warn "Test workspace '$TEST_WS' has $window_count window(s)"
        log_warn "Move or close them before running tests to avoid interference"
        log_fail "Aborting: test workspace is not empty"
        return 1
    fi

    log_verbose "Test workspace '$TEST_WS' is empty -- safe to proceed"
    return 0
}

#---------------------------------------------------------------------------
# Workspace Reset
#---------------------------------------------------------------------------

# Clean reset of the test workspace (flatten tree)
reset_test_workspace() {
    log_verbose "Resetting test workspace $TEST_WS"
    aerospace workspace "$TEST_WS"
    aerospace flatten-workspace-tree --workspace "$TEST_WS" 2>/dev/null || true
    sleep 0.2
}
