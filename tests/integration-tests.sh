#!/usr/bin/env bash
#
# Integration Tests for alm wrapper dispatch and startup scripts
# Tests the 6 dispatch paths of the alm wrapper function and startup script
# behavior for configurable workspaces (present/absent/inactive).
#
# Usage:
#   ./tests/integration-tests.sh           # Run all tests
#   ./tests/integration-tests.sh 1.1       # Run specific test
#   ./tests/integration-tests.sh --list    # List available tests
#
# These tests mock aerospace-layout-manager with a stub that records
# the arguments it was called with.
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

    # Create directory structure mirroring nix-config layout
    mkdir -p "$TEST_TMP/nix-config/modules/darwin/scripts/layouts/avp"
    mkdir -p "$TEST_TMP/home/.config/aerospace/layouts/avp"
    mkdir -p "$TEST_TMP/home/.local/bin"

    # Create the stub for aerospace-layout-manager that records calls
    cat > "$TEST_TMP/home/.local/bin/aerospace-layout-manager" <<'STUB'
#!/usr/bin/env bash
# Stub: record arguments to a log file
echo "$@" >> "${ALM_STUB_LOG}"
STUB
    chmod +x "$TEST_TMP/home/.local/bin/aerospace-layout-manager"

    # Create static layout fixtures (minimal valid JSON)
    local static_dual=("daily" "brave" "work" "messages" "org" "play")
    for ws in "${static_dual[@]}"; do
        echo '[{"name":"'"$ws"'","type":"workspace","root-container":{"type":"container","layout":"h_accordion","orientation":"horizontal","children":[{"type":"window","app-bundle-id":"com.example.App","app-name":"App","title":"","window-id":1,"startup":"echo test"}]}}]' \
            > "$TEST_TMP/nix-config/modules/darwin/scripts/layouts/$ws.json"
    done

    # AVP static layouts (subset)
    local static_avp=("daily" "messages" "org")
    for ws in "${static_avp[@]}"; do
        echo '[{"name":"'"$ws"'","type":"workspace","root-container":{"type":"container","layout":"h_tiles","orientation":"horizontal","children":[{"type":"window","app-bundle-id":"com.example.App","app-name":"App","title":"","window-id":1,"startup":"echo test"}]}}]' \
            > "$TEST_TMP/nix-config/modules/darwin/scripts/layouts/avp/$ws.json"
    done

    # Create the stub log file
    export ALM_STUB_LOG="$TEST_TMP/stub-calls.log"
    touch "$ALM_STUB_LOG"

    # Set HOME override for tests
    export TEST_HOME="$TEST_TMP/home"
}

# Clean up temp directory
teardown_test_env() {
    if [[ -n "$TEST_TMP" && -d "$TEST_TMP" ]]; then
        rm -rf "$TEST_TMP"
    fi
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

# Assert file contains a specific line
assert_file_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-file contains '$pattern'}"

    if grep -qF "$pattern" "$file" 2>/dev/null; then
        log_verbose "ASSERT OK: $msg"
        return 0
    else
        log_fail "ASSERT FAILED: $msg"
        log_fail "  file: $file"
        log_fail "  expected to contain: $pattern"
        if [[ -f "$file" ]]; then
            log_fail "  actual contents: $(cat "$file")"
        else
            log_fail "  file does not exist"
        fi
        return 1
    fi
}

# Assert file does NOT contain a pattern
assert_file_not_contains() {
    local file="$1"
    local pattern="$2"
    local msg="${3:-file does not contain '$pattern'}"

    if ! grep -qF "$pattern" "$file" 2>/dev/null; then
        log_verbose "ASSERT OK: $msg"
        return 0
    else
        log_fail "ASSERT FAILED: $msg"
        log_fail "  file: $file"
        log_fail "  expected NOT to contain: $pattern"
        log_fail "  actual contents: $(cat "$file")"
        return 1
    fi
}

# Assert stub log has exactly N calls
assert_stub_call_count() {
    local expected="$1"
    local msg="${2:-stub call count}"

    local actual=0
    if [[ -f "$ALM_STUB_LOG" ]]; then
        actual=$(wc -l < "$ALM_STUB_LOG" | tr -d ' ')
    fi

    assert_eq "$expected" "$actual" "$msg"
}

# Assert exit code
assert_exit_code() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-exit code}"

    assert_eq "$expected" "$actual" "$msg"
}

#---------------------------------------------------------------------------
# alm wrapper function (extracted from zsh.nix, adapted for testing)
#
# The real function uses ~ and hardcoded paths. This version takes the
# paths from environment variables so we can point at test fixtures.
#---------------------------------------------------------------------------

# Build a testable version of the alm wrapper that uses our temp dirs
create_alm_wrapper() {
    cat > "$TEST_TMP/alm.sh" <<'WRAPPER_EOF'
#!/usr/bin/env bash
# Testable version of the alm wrapper from zsh.nix
# Uses TEST_HOME and TEST_NIX_CONFIG_BASE instead of ~ and hardcoded paths
alm_wrapper() {
    local base="${TEST_NIX_CONFIG_BASE}/modules/darwin/scripts"
    local configurable='code code2 code3 homelab'
    local gen_base="${TEST_HOME}/.config/aerospace/layouts"

    if [ "$1" = avp ] || [ "$1" = dual ]; then
        local mode="$1"; shift
        if [ -z "${1:-}" ]; then
            # Full startup -- delegate to startup script
            if [ "$mode" = avp ]; then
                cd "$base" && ./aerospace-avp-startup.sh
            else
                cd "$base" && ./aerospace-dual-startup.sh
            fi
        else
            local ws="$1"
            local gen_dir="$gen_base"
            [ "$mode" = avp ] && gen_dir="$gen_dir/avp"

            if echo "$configurable" | grep -qw "$ws"; then
                # Configurable workspace -- use generated layout
                if [ -f "$gen_dir/$ws.json" ]; then
                    "${TEST_HOME}/.local/bin/aerospace-layout-manager" "$ws" "$gen_dir/$ws.json"
                else
                    echo "No project assigned to $ws. Run alm-config to configure." >&2
                    return 1
                fi
            else
                # Static workspace -- use nix-managed layout
                local layout_dir="$base/layouts"
                [ "$mode" = avp ] && layout_dir="$layout_dir/avp"
                "${TEST_HOME}/.local/bin/aerospace-layout-manager" "$ws" "$layout_dir/$ws.json"
            fi
        fi
    else
        # Default mode (dual), single workspace
        local ws="$1"
        if echo "$configurable" | grep -qw "$ws"; then
            if [ -f "$gen_base/$ws.json" ]; then
                "${TEST_HOME}/.local/bin/aerospace-layout-manager" "$ws" "$gen_base/$ws.json"
            else
                echo "No project assigned to $ws. Run alm-config to configure." >&2
                return 1
            fi
        else
            "${TEST_HOME}/.local/bin/aerospace-layout-manager" "$ws" "$base/layouts/$ws.json"
        fi
    fi
}
WRAPPER_EOF
    chmod +x "$TEST_TMP/alm.sh"
}

# Source the wrapper and run it
run_alm() {
    export TEST_HOME="$TEST_TMP/home"
    export TEST_NIX_CONFIG_BASE="$TEST_TMP/nix-config"
    # Clear stub log before each call
    > "$ALM_STUB_LOG"
    # Source and run
    source "$TEST_TMP/alm.sh"
    alm_wrapper "$@"
}

#---------------------------------------------------------------------------
# Startup script helpers
#
# Create testable versions of the startup scripts that use our temp dirs.
#---------------------------------------------------------------------------

create_startup_scripts() {
    # Dual startup script
    cat > "$TEST_TMP/nix-config/modules/darwin/scripts/aerospace-dual-startup.sh" <<'DUAL_EOF'
#!/usr/bin/env bash
set -e

LAYOUT_ENGINE="${TEST_HOME}/.local/bin/aerospace-layout-manager"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAYOUTS_DIR="$SCRIPT_DIR/layouts"

# Static workspaces -- always apply from nix-managed layouts
$LAYOUT_ENGINE daily "$LAYOUTS_DIR/daily.json"
$LAYOUT_ENGINE brave "$LAYOUTS_DIR/brave.json"
$LAYOUT_ENGINE work "$LAYOUTS_DIR/work.json"
$LAYOUT_ENGINE messages "$LAYOUTS_DIR/messages.json"
$LAYOUT_ENGINE org "$LAYOUTS_DIR/org.json"
$LAYOUT_ENGINE play "$LAYOUTS_DIR/play.json"

# Configurable workspaces -- apply only if generated layout exists AND workspace is active
GEN_LAYOUTS="${TEST_HOME}/.config/aerospace/layouts"
PROJECTS_JSON="${TEST_HOME}/.config/aerospace/projects.json"

for ws in code code2 code3 homelab; do
  if [[ -f "$GEN_LAYOUTS/$ws.json" ]]; then
    if [[ -f "$PROJECTS_JSON" ]]; then
      active=$(jq -r --arg ws "$ws" '.workspaces[$ws].active // empty' "$PROJECTS_JSON" 2>/dev/null)
      if [[ -z "$active" ]]; then
        if [[ "$ws" == "code" || "$ws" == "homelab" ]]; then
          active="true"
        else
          active="false"
        fi
      fi
    else
      continue
    fi
    if [[ "$active" == "true" ]]; then
      $LAYOUT_ENGINE "$ws" "$GEN_LAYOUTS/$ws.json"
    fi
  fi
done
DUAL_EOF
    chmod +x "$TEST_TMP/nix-config/modules/darwin/scripts/aerospace-dual-startup.sh"

    # AVP startup script
    cat > "$TEST_TMP/nix-config/modules/darwin/scripts/aerospace-avp-startup.sh" <<'AVP_EOF'
#!/usr/bin/env bash
set -e

LAYOUT_ENGINE="${TEST_HOME}/.local/bin/aerospace-layout-manager"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LAYOUTS_DIR="$SCRIPT_DIR/layouts/avp"

# Static workspaces -- always apply from nix-managed layouts
$LAYOUT_ENGINE daily "$LAYOUTS_DIR/daily.json"
$LAYOUT_ENGINE messages "$LAYOUTS_DIR/messages.json"
$LAYOUT_ENGINE org "$LAYOUTS_DIR/org.json"

# Configurable workspaces -- apply only if generated layout exists AND workspace is active
GEN_LAYOUTS="${TEST_HOME}/.config/aerospace/layouts/avp"
PROJECTS_JSON="${TEST_HOME}/.config/aerospace/projects.json"

for ws in code code2 code3 homelab; do
  if [[ -f "$GEN_LAYOUTS/$ws.json" ]]; then
    if [[ -f "$PROJECTS_JSON" ]]; then
      active=$(jq -r --arg ws "$ws" '.workspaces[$ws].active // empty' "$PROJECTS_JSON" 2>/dev/null)
      if [[ -z "$active" ]]; then
        if [[ "$ws" == "code" || "$ws" == "homelab" ]]; then
          active="true"
        else
          active="false"
        fi
      fi
    else
      continue
    fi
    if [[ "$active" == "true" ]]; then
      $LAYOUT_ENGINE "$ws" "$GEN_LAYOUTS/$ws.json"
    fi
  fi
done
AVP_EOF
    chmod +x "$TEST_TMP/nix-config/modules/darwin/scripts/aerospace-avp-startup.sh"
}

# Write a projects.json fixture
write_projects_json() {
    local json="$1"
    mkdir -p "$TEST_TMP/home/.config/aerospace"
    echo "$json" > "$TEST_TMP/home/.config/aerospace/projects.json"
}

# Create a generated layout file for a configurable workspace
create_generated_layout() {
    local mode="$1"  # dual or avp
    local ws="$2"
    local dir="$TEST_TMP/home/.config/aerospace/layouts"
    [[ "$mode" == "avp" ]] && dir="$dir/avp"
    mkdir -p "$dir"
    echo '[{"name":"'"$ws"'","type":"workspace","root-container":{"type":"container","layout":"h_accordion","orientation":"horizontal","children":[{"type":"window","app-bundle-id":"com.microsoft.VSCode","app-name":"Code","title":"test","window-id":1,"startup":"code ~/test"}]}}]' \
        > "$dir/$ws.json"
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
    create_alm_wrapper
    create_startup_scripts

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
# Section 1: alm wrapper dispatch — dual mode (default)
#---------------------------------------------------------------------------

# 1.1 Static workspace (dual, default mode) — e.g., `alm daily`
test_1_1_static_dual_default() {
    local result
    result=$(run_alm daily 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "exit code for static dual workspace"
    assert_file_contains "$ALM_STUB_LOG" \
        "daily $TEST_TMP/nix-config/modules/darwin/scripts/layouts/daily.json" \
        "stub called with static dual layout path"
    assert_stub_call_count "1" "exactly one stub call"
}

# 1.2 Configurable workspace with generated layout (dual, default mode) — e.g., `alm code`
test_1_2_configurable_with_layout_dual() {
    create_generated_layout dual code
    local result
    result=$(run_alm code 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "exit code for configurable workspace with layout"
    assert_file_contains "$ALM_STUB_LOG" \
        "code $TEST_TMP/home/.config/aerospace/layouts/code.json" \
        "stub called with generated layout path"
    assert_stub_call_count "1" "exactly one stub call"
}

# 1.3 Configurable workspace without generated layout (dual, default mode) — error
test_1_3_configurable_without_layout_dual() {
    local stderr_output
    stderr_output=$(run_alm code 2>&1 || true)
    # Re-run to capture exit code separately
    > "$ALM_STUB_LOG"
    source "$TEST_TMP/alm.sh"
    export TEST_HOME="$TEST_TMP/home"
    export TEST_NIX_CONFIG_BASE="$TEST_TMP/nix-config"
    local rc=0
    alm_wrapper code 2>/dev/null || rc=$?
    assert_exit_code "1" "$rc" "exit code for missing configurable layout"
    assert_stub_call_count "0" "no stub calls when layout missing"
    # Check error message
    local err
    err=$(alm_wrapper code 2>&1 >/dev/null || true)
    echo "$err" | grep -qF "No project assigned to code" || {
        log_fail "Expected error message about no project assigned"
        log_fail "  actual stderr: $err"
        return 1
    }
    log_verbose "Error message correct"
}

#---------------------------------------------------------------------------
# Section 2: alm wrapper dispatch — AVP mode (explicit)
#---------------------------------------------------------------------------

# 2.1 Static workspace (AVP mode) — e.g., `alm avp daily`
test_2_1_static_avp() {
    local result
    result=$(run_alm avp daily 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "exit code for static AVP workspace"
    assert_file_contains "$ALM_STUB_LOG" \
        "daily $TEST_TMP/nix-config/modules/darwin/scripts/layouts/avp/daily.json" \
        "stub called with static AVP layout path"
    assert_stub_call_count "1" "exactly one stub call"
}

# 2.2 Configurable workspace with generated layout (AVP mode) — e.g., `alm avp code`
test_2_2_configurable_with_layout_avp() {
    create_generated_layout avp code
    local result
    result=$(run_alm avp code 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "exit code for configurable AVP workspace with layout"
    assert_file_contains "$ALM_STUB_LOG" \
        "code $TEST_TMP/home/.config/aerospace/layouts/avp/code.json" \
        "stub called with generated AVP layout path"
    assert_stub_call_count "1" "exactly one stub call"
}

# 2.3 Configurable workspace without generated layout (AVP mode) — error
test_2_3_configurable_without_layout_avp() {
    > "$ALM_STUB_LOG"
    source "$TEST_TMP/alm.sh"
    export TEST_HOME="$TEST_TMP/home"
    export TEST_NIX_CONFIG_BASE="$TEST_TMP/nix-config"
    local rc=0
    alm_wrapper avp code 2>/dev/null || rc=$?
    assert_exit_code "1" "$rc" "exit code for missing configurable AVP layout"
    assert_stub_call_count "0" "no stub calls when AVP layout missing"
    # Check error message
    local err
    err=$(alm_wrapper avp code 2>&1 >/dev/null || true)
    echo "$err" | grep -qF "No project assigned to code" || {
        log_fail "Expected error message about no project assigned"
        log_fail "  actual stderr: $err"
        return 1
    }
    log_verbose "Error message correct"
}

#---------------------------------------------------------------------------
# Section 3: alm wrapper dispatch — explicit dual mode
#---------------------------------------------------------------------------

# 3.1 Explicit dual mode works same as default for static workspace
test_3_1_explicit_dual_static() {
    local result
    result=$(run_alm dual daily 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "exit code for explicit dual static workspace"
    assert_file_contains "$ALM_STUB_LOG" \
        "daily $TEST_TMP/nix-config/modules/darwin/scripts/layouts/daily.json" \
        "stub called with static dual layout path via explicit dual mode"
    assert_stub_call_count "1" "exactly one stub call"
}

# 3.2 Explicit dual mode works same as default for configurable workspace
test_3_2_explicit_dual_configurable() {
    create_generated_layout dual homelab
    local result
    result=$(run_alm dual homelab 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "exit code for explicit dual configurable workspace"
    assert_file_contains "$ALM_STUB_LOG" \
        "homelab $TEST_TMP/home/.config/aerospace/layouts/homelab.json" \
        "stub called with generated dual layout path via explicit mode"
    assert_stub_call_count "1" "exactly one stub call"
}

#---------------------------------------------------------------------------
# Section 4: Startup script — dual mode
#---------------------------------------------------------------------------

# 4.1 Configurable workspace present AND active — applied
test_4_1_startup_dual_present_active() {
    create_generated_layout dual code
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "test", "active": true},
            "code2": {"project": null, "active": false},
            "code3": {"project": null, "active": false},
            "homelab": {"project": null, "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # Should have 6 static + 1 configurable (code is active with layout)
    assert_stub_call_count "7" "6 static + 1 active configurable"
    assert_file_contains "$ALM_STUB_LOG" \
        "code $TEST_TMP/home/.config/aerospace/layouts/code.json" \
        "code workspace applied from generated layout"
}

# 4.2 Configurable workspace present but NOT active — skipped
test_4_2_startup_dual_present_inactive() {
    create_generated_layout dual code2
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": null, "active": true},
            "code2": {"project": "test", "active": false},
            "code3": {"project": null, "active": false},
            "homelab": {"project": null, "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # Should have 6 static only (code2 has layout but is inactive)
    assert_stub_call_count "6" "6 static only, inactive configurable skipped"
    assert_file_not_contains "$ALM_STUB_LOG" "code2" \
        "code2 workspace NOT applied because inactive"
}

# 4.3 Configurable workspace absent — skipped
test_4_3_startup_dual_absent() {
    # No generated layouts at all
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "test", "active": true},
            "code2": {"project": null, "active": false},
            "code3": {"project": null, "active": false},
            "homelab": {"project": null, "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # Should have 6 static only (no generated layouts exist)
    assert_stub_call_count "6" "6 static only, no generated layouts"
    assert_file_not_contains "$ALM_STUB_LOG" "code " \
        "code workspace NOT applied because no layout exists"
}

# 4.4 Default active values when not set in projects.json
test_4_4_startup_dual_default_active() {
    # Create generated layouts for code and homelab (default active=true)
    # and code2 (default active=false)
    create_generated_layout dual code
    create_generated_layout dual code2
    create_generated_layout dual homelab
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "test"},
            "code2": {"project": "test2"},
            "code3": {"project": null},
            "homelab": {"project": "test3"}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # code and homelab should be applied (default active=true)
    # code2 should be skipped (default active=false)
    assert_stub_call_count "8" "6 static + code + homelab (default active)"
    assert_file_contains "$ALM_STUB_LOG" \
        "code $TEST_TMP/home/.config/aerospace/layouts/code.json" \
        "code applied (default active=true)"
    assert_file_contains "$ALM_STUB_LOG" \
        "homelab $TEST_TMP/home/.config/aerospace/layouts/homelab.json" \
        "homelab applied (default active=true)"
    assert_file_not_contains "$ALM_STUB_LOG" "code2" \
        "code2 skipped (default active=false)"
}

# 4.5 No projects.json at all — skip all configurable workspaces
test_4_5_startup_dual_no_projects_json() {
    create_generated_layout dual code
    create_generated_layout dual homelab
    # Do NOT create projects.json

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # Should have 6 static only (no projects.json means skip all configurable)
    assert_stub_call_count "6" "6 static only, no projects.json"
}

#---------------------------------------------------------------------------
# Section 5: Startup script — AVP mode
#---------------------------------------------------------------------------

# 5.1 Configurable workspace present AND active (AVP) — applied
test_5_1_startup_avp_present_active() {
    create_generated_layout avp code
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "test", "active": true},
            "code2": {"project": null, "active": false},
            "code3": {"project": null, "active": false},
            "homelab": {"project": null, "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-avp-startup.sh

    # Should have 3 static (daily, messages, org) + 1 configurable (code)
    assert_stub_call_count "4" "3 AVP static + 1 active configurable"
    assert_file_contains "$ALM_STUB_LOG" \
        "code $TEST_TMP/home/.config/aerospace/layouts/avp/code.json" \
        "code workspace applied from generated AVP layout"
}

# 5.2 Configurable workspace present but NOT active (AVP) — skipped
test_5_2_startup_avp_present_inactive() {
    create_generated_layout avp code3
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": null, "active": true},
            "code2": {"project": null, "active": false},
            "code3": {"project": "test", "active": false},
            "homelab": {"project": null, "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-avp-startup.sh

    # Should have 3 static only (code3 has layout but is inactive)
    assert_stub_call_count "3" "3 AVP static only, inactive configurable skipped"
    assert_file_not_contains "$ALM_STUB_LOG" "code3" \
        "code3 workspace NOT applied because inactive"
}

# 5.3 Configurable workspace absent (AVP) — skipped
test_5_3_startup_avp_absent() {
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "test", "active": true},
            "code2": {"project": null, "active": false},
            "code3": {"project": null, "active": false},
            "homelab": {"project": null, "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-avp-startup.sh

    # Should have 3 static only
    assert_stub_call_count "3" "3 AVP static only, no generated layouts"
}

#---------------------------------------------------------------------------
# Section 6: Edge cases
#---------------------------------------------------------------------------

# 6.1 All 4 configurable workspaces active and present
test_6_1_all_configurable_active() {
    for ws in code code2 code3 homelab; do
        create_generated_layout dual "$ws"
    done
    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "p1", "active": true},
            "code2": {"project": "p2", "active": true},
            "code3": {"project": "p3", "active": true},
            "homelab": {"project": "p4", "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # Should have 6 static + 4 configurable = 10
    assert_stub_call_count "10" "6 static + 4 configurable"
    for ws in code code2 code3 homelab; do
        assert_file_contains "$ALM_STUB_LOG" "$ws" \
            "$ws workspace applied"
    done
}

# 6.2 Configurable workspace names don't match static workspace names
test_6_2_no_false_configurable_match() {
    # The word "code" should not match within other workspace names
    local result
    result=$(run_alm play 2>&1)
    local rc=$?
    assert_exit_code "0" "$rc" "static workspace 'play' should work"
    assert_file_contains "$ALM_STUB_LOG" \
        "play $TEST_TMP/nix-config/modules/darwin/scripts/layouts/play.json" \
        "play uses static layout"
    assert_stub_call_count "1" "exactly one stub call"
}

# 6.3 Mixed scenario — some configurable present, some absent, some inactive
test_6_3_mixed_configurable() {
    create_generated_layout dual code      # present + active
    create_generated_layout dual code2     # present + inactive
    # code3: absent
    create_generated_layout dual homelab   # present + active

    write_projects_json '{
        "projects": {},
        "workspaces": {
            "code": {"project": "p1", "active": true},
            "code2": {"project": "p2", "active": false},
            "code3": {"project": null, "active": false},
            "homelab": {"project": "p4", "active": true}
        }
    }'

    export TEST_HOME="$TEST_TMP/home"
    > "$ALM_STUB_LOG"
    cd "$TEST_TMP/nix-config/modules/darwin/scripts"
    ./aerospace-dual-startup.sh

    # 6 static + code + homelab = 8 (code2 inactive, code3 absent)
    assert_stub_call_count "8" "6 static + code + homelab"
    assert_file_contains "$ALM_STUB_LOG" "code " "code applied"
    assert_file_contains "$ALM_STUB_LOG" "homelab" "homelab applied"
    assert_file_not_contains "$ALM_STUB_LOG" "code2" "code2 skipped (inactive)"
    assert_file_not_contains "$ALM_STUB_LOG" "code3" "code3 skipped (absent)"
}

#---------------------------------------------------------------------------
# Test Registry
#---------------------------------------------------------------------------

declare -A TESTS

# Section 1: alm wrapper — dual mode (default)
TESTS["1.1"]="test_1_1_static_dual_default:Static workspace dual (default mode)"
TESTS["1.2"]="test_1_2_configurable_with_layout_dual:Configurable workspace with layout (dual default)"
TESTS["1.3"]="test_1_3_configurable_without_layout_dual:Configurable workspace without layout (dual default)"

# Section 2: alm wrapper — AVP mode
TESTS["2.1"]="test_2_1_static_avp:Static workspace AVP mode"
TESTS["2.2"]="test_2_2_configurable_with_layout_avp:Configurable workspace with layout (AVP)"
TESTS["2.3"]="test_2_3_configurable_without_layout_avp:Configurable workspace without layout (AVP)"

# Section 3: alm wrapper — explicit dual mode
TESTS["3.1"]="test_3_1_explicit_dual_static:Explicit dual mode static workspace"
TESTS["3.2"]="test_3_2_explicit_dual_configurable:Explicit dual mode configurable workspace"

# Section 4: Startup script — dual mode
TESTS["4.1"]="test_4_1_startup_dual_present_active:Dual startup configurable present and active"
TESTS["4.2"]="test_4_2_startup_dual_present_inactive:Dual startup configurable present but inactive"
TESTS["4.3"]="test_4_3_startup_dual_absent:Dual startup configurable absent"
TESTS["4.4"]="test_4_4_startup_dual_default_active:Dual startup default active values"
TESTS["4.5"]="test_4_5_startup_dual_no_projects_json:Dual startup no projects.json"

# Section 5: Startup script — AVP mode
TESTS["5.1"]="test_5_1_startup_avp_present_active:AVP startup configurable present and active"
TESTS["5.2"]="test_5_2_startup_avp_present_inactive:AVP startup configurable present but inactive"
TESTS["5.3"]="test_5_3_startup_avp_absent:AVP startup configurable absent"

# Section 6: Edge cases
TESTS["6.1"]="test_6_1_all_configurable_active:All 4 configurable workspaces active"
TESTS["6.2"]="test_6_2_no_false_configurable_match:Static workspace not matched as configurable"
TESTS["6.3"]="test_6_3_mixed_configurable:Mixed configurable present/absent/inactive"

#---------------------------------------------------------------------------
# Runner
#---------------------------------------------------------------------------

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
    log_info "Running all integration tests..."
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
        echo "  test-id   Run specific test (e.g., 1.1)"
        echo "  --list    List available tests"
        echo "  --help    Show this help"
        echo ""
        echo "Environment:"
        echo "  VERBOSE   Enable verbose output (default: false)"
    else
        setup_test_env
        create_alm_wrapper
        create_startup_scripts
        run_single_test "$1"
        teardown_test_env
    fi
}

main "$@"
