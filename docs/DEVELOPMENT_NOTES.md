# Layout Recreation from Dump-Tree - Development Notes

## Goal
Create a script that takes aerospace dump-tree JSON output and recreates the exact layout.

## Test Case
Target structure from dump:
```
v_accordion (root):
├── h_tiles container A [Code, Xcode, Code]
├── Safari (standalone window)
└── h_tiles container B:
    ├── iTerm2
    └── v_tiles container C [iTerm2, iTerm2]
```

DFS window order: Code(17470), Xcode(199), Code(149), Safari(113), iTerm(4137), iTerm(17570), iTerm(20071)

## Environment
- Monitor: LG HDR 4K (portrait mode - 2160x3840, rotated 270°)
- On portrait monitor, windows stack **vertically** by default

---

## Approach 1: join-with --window-id

**Theory**: Use `aerospace join-with --window-id X direction` to join focused window with a specific target window.

**Implementation**:
```bash
focus_window first_window_id
for each subsequent child:
    aerospace join-with --window-id child_window_id direction
```

**Result**: ❌ FAILED

**Reason**: Misunderstanding of the command. `--window-id X direction` means "take window X and join it with whatever is in that direction", NOT "join the focused window with window X".

---

## Approach 2: Sequential join-with direction

**Theory**: Focus first window, then use `join-with direction` repeatedly to join with adjacent windows.

**Implementation**:
```bash
focus_window first_window_id
for i in 1 to num_children-1:
    aerospace join-with direction
```

**Result**: ❌ PARTIALLY FAILED

**Issue**: `join-with right` failed with "No windows in the specified direction" on portrait monitor.

**Reason**: On portrait monitor, even with h_tiles layout, windows are arranged vertically (due to monitor aspect ratio). `join-with right` looks for windows to the right spatially, but windows are stacked up/down.

---

## Approach 3: Set workspace layout first, then join

**Theory**: Set the workspace layout to h_tiles before attempting horizontal joins.

**Implementation**:
```bash
# After moving all windows
aerospace workspace test
aerospace layout h_tiles
# Then do joins
aerospace focus --window-id 17470
aerospace join-with right
aerospace join-with right
```

**Result**: ❌ UNEXPECTED BEHAVIOR

**Output**:
```json
{
  "layout": "h_tiles",
  "children": [
    "Xcode",
    {"c": "v_tiles", "w": ["Code", "Code"]},
    "Safari", "iTerm2", "iTerm2", "iTerm2"
  ]
}
```

**Issues**:
1. Created v_tiles container instead of h_tiles
2. Joined Code+Code (window 1 with window 3), skipping Xcode (window 2)
3. Order is wrong - Xcode is now first

**Analysis**: The join-with command joins based on spatial position, not tree order. On portrait monitor:
- Windows are arranged vertically even with h_tiles
- "right" direction may wrap around or behave unexpectedly
- The spatial layout doesn't match the tree order

---

## Key Discoveries

### Discovery 1: Portrait Monitor Behavior
On portrait monitors (taller than wide):
- Windows arranged "horizontally" actually stack vertically
- `join-with right/left` may fail or behave unexpectedly
- Need to use `join-with down/up` instead

### Discovery 2: join-with Works on Spatial Position
The `join-with direction` command joins based on the **spatial position** of windows, not their order in the tree. This creates problems when:
- Monitor orientation affects spatial arrangement
- Windows aren't in a predictable spatial order

### Discovery 3: Layout Type Affects Join Direction
From the existing working code (layout-functions.sh):
```bash
# In v_tiles parent: use down
# In h_tiles parent: use right
```
But this assumes the parent layout affects spatial arrangement, which may not hold on portrait monitors.

---

## Next Approaches to Try

### Approach 4: Use down direction for all joins on portrait
Since windows stack vertically on portrait, try:
```bash
aerospace join-with down
```
Instead of `right` for horizontal containers.

### Approach 5: Flatten and re-create with explicit positions
1. Flatten workspace
2. Move windows one by one
3. Use focus and join-with based on spatial awareness of portrait mode

### Approach 6: Use --window-id correctly
The `--window-id` flag specifies which window to OPERATE ON, not which window to join with. Explore if we can:
```bash
# Make window X join with what's in direction
aerospace join-with --window-id 199 down  # 199 joins with whoever is below it
```

### Approach 7: Create containers from inside-out
1. First create innermost containers
2. Then create parent containers that wrap them
3. Use the fact that after a join, the container stays in place of first window

---

---

## Approach 5: Working Pattern from layout-functions.sh

**Theory**: Use the same approach as the working layout-functions.sh:
1. Move windows in DFS order
2. Set root layout FIRST
3. For each nested container (in DFS order), focus first window, join-with based on parent layout, set layout

**Implementation**:
```bash
# Set root to v_accordion
aerospace layout v_accordion

# Create h_tiles_A (Code, Xcode, Code)
aerospace focus --window-id 17470
aerospace join-with down  # parent is v_accordion
aerospace join-with down
aerospace layout h_tiles
```

**Result**: ❌ PARTIAL FAILURE

**Issues observed**:
1. First h_tiles_A creation: Only joined 2 windows (Code+Code), Xcode got separated
2. Root layout kept changing unexpectedly (v_accordion → h_accordion → h_tiles)
3. "No windows in the specified direction" errors
4. Final structure completely wrong

**Analysis**:
- The working org-dual-fn layout is simpler: 2 levels, 2-window groups only
- Our test layout is complex: 3 levels, 3-window groups, standalone windows
- join-with behavior is unpredictable with complex structures
- After a join, the tree structure changes and affects subsequent joins

**Successful working case comparison**:
```
org-dual-fn (WORKS):
  v_tiles:
  ├── h_accordion [2 windows]
  └── h_accordion [2 windows]

test-layout (FAILS):
  v_accordion:
  ├── h_tiles [3 windows]
  ├── standalone window
  └── h_tiles:
      ├── window
      └── v_tiles [2 windows]
```

Differences that may cause issues:
- 3+ windows in a group
- Standalone windows between groups
- 3-level deep nesting
- Mixed container types (tiles + accordion)

---

## Current Understanding of aerospace join-with

```
aerospace join-with [--window-id <wid>] <direction>

- Without --window-id: Operates on focused window
- With --window-id: Operates on specified window

- direction (left|right|up|down): The direction to look for a window to join with
- The window in that direction becomes part of the same container as the source window
- After join, the container takes the position of the source window
```

The command is **spatial** - it looks for a window in the specified direction based on **screen position**, not tree order.

---

## Working Example from layout-functions.sh

The existing code that works uses this pattern:
```bash
# Move windows to workspace in specific order
# Focus first window
# Join with direction repeatedly
# Set layout type

# For h_accordion in h_tiles parent: use right
# For h_accordion in v_tiles parent: use down
```

The key is that the parent layout type determines the join direction because it affects how children are spatially arranged.

---

## Approach 6: Study CarterMcAlister/aerospace-layout-manager

**Reference**: https://github.com/CarterMcAlister/aerospace-layout-manager

**Their Algorithm** (from index.ts):
```typescript
// 1. Clear workspace (move to stash)
await clearWorkspace(layout.workspace);

// 2. Move all windows to workspace in DFS order
await traverseTreeMove(layout.windows);

// 3. Reposition windows
await traverseTreeReposition(layout.windows);

// 4. Switch to workspace
await switchToWorkspace(layout.workspace);

// 5. Resize windows
await traverseTreeResize(layout.windows);
```

**Key function - traverseTreeReposition**:
```typescript
async function traverseTreeReposition(tree: LayoutItem[], depth = 0) {
    for await (const [i, item] of tree.entries()) {
        if (depth === 0 && i === 0) {
            // First item at root: flatten and set workspace layout
            await flattenWorkspace(layout.workspace);
            await setWorkspaceLayout(layout.workspace, layout.layout);
        }
        if ("bundleId" in item) {
            if (depth > 0 && i > 0) {
                // Subsequent windows in a group: join with previous
                const windowId = await getWindowId(item.bundleId);
                if (windowId) {
                    await focusWindow(windowId);
                    await joinItemWithPreviousWindow(windowId);
                }
            }
        } else if ("windows" in item) {
            await traverseTreeReposition(item.windows, depth + 1);
        }
    }
}

async function joinItemWithPreviousWindow(windowId: string) {
    await $`aerospace join-with --window-id ${windowId} left`.nothrow();
}
```

**Key Insight**: They use `join-with --window-id X left` where X is the window to join.

**Limitations**:
- Only handles 2 levels of nesting (workspace → groups → windows)
- Doesn't explicitly set nested container layouts
- Relies on DFS order and horizontal flattening

---

## Approach 7: Testing join-with Directions

**Test 1: What container type does each direction create?**

Setup: Flatten workspace, set tiles horizontal (windows side by side)

| Command | Result | Notes |
|---------|--------|-------|
| `join-with --window-id X left` | v_tiles | Joins with window to the left |
| `join-with --window-id X right` | v_tiles | Would join with window to the right |
| `join-with --window-id X down` | FAIL | "No windows in the specified direction" |
| `join-with --window-id X up` | FAIL | "No windows in the specified direction" |

Setup: Flatten workspace, set tiles vertical (windows stacked)

| Command | Result | Notes |
|---------|--------|-------|
| `join-with --window-id X left` | FAIL | "No windows in the specified direction" |
| `join-with --window-id X up` | h_tiles | Joins with window above |
| `join-with --window-id X down` | h_tiles | Would join with window below |

**CRITICAL DISCOVERY**:
- `join-with left/right` → creates `v_tiles` container
- `join-with up/down` → creates `h_tiles` container
- The direction must match the actual spatial arrangement of windows!

---

## Approach 8: Change Layout After Container Creation

**Theory**: Create container with join-with, then change its layout type.

**Test**:
```bash
# Create v_tiles container using left
aerospace join-with --window-id 4137 left
# Result: v_tiles container created

# Focus window in container and change layout
aerospace focus --window-id 4137
aerospace layout h_tiles
# Result: Container changed to h_tiles ✓
```

**Result**: ✅ Works! Can create container with any join direction, then change layout type.

---

## Approach 9: Full Algorithm Test

**Target Structure**:
```
v_accordion:
├── h_tiles [Safari(113), iTerm2(20071)]
└── v_tiles [iTerm2(17570), iTerm2(4137)]
```

**Algorithm**:
```bash
# Step 1: Flatten and set horizontal tiles
aerospace flatten-workspace-tree --workspace temp
aerospace layout tiles horizontal
# Windows: 113, 20071, 17570, 4137 (side by side)

# Step 2: Join 20071 with 113 (Safari)
aerospace join-with --window-id 20071 left
# Result: v_tiles [113, 20071], 17570, 4137

# Step 3: Change that container to h_tiles
aerospace focus --window-id 20071
aerospace layout h_tiles
# Result: h_tiles [113, 20071], 4137, 17570
# ⚠️ ROOT LAYOUT CHANGED! From h_tiles to v_tiles

# Step 4: Join 4137 with 17570
aerospace join-with --window-id 4137 left
# FAILS: "No windows in the specified direction"
# Because root is now v_tiles, remaining windows are stacked vertically!
```

**Result**: ❌ FAILED

**Issues Discovered**:

### Issue 1: Layout Commands Have Side Effects
When running `aerospace layout h_tiles` on a window in a nested container, it ALSO changed the root container's layout from h_tiles to v_tiles!

### Issue 2: Root Layout Change Breaks Subsequent Joins
After root changed to v_tiles, the remaining windows (4137, 17570) are no longer horizontally adjacent. So `join-with left` fails because there's nothing to the left.

### Issue 3: The CarterMcAlister Approach Has Same Problem
Their code only works for simple structures because:
1. They flatten first (all windows horizontal)
2. They only join at depth > 0 (nested groups)
3. They don't handle deeply nested structures
4. Their examples are all 2-level nesting max

---

## Current Blockers

1. **`aerospace layout` has unpredictable side effects** - Setting layout on a nested container can change parent container's layout

2. **Join direction depends on current spatial arrangement** - After tree structure changes, the spatial arrangement changes, breaking subsequent joins

3. **No way to target specific containers** - Can only operate through windows, but layout commands affect parent containers unpredictably

4. **No "create container" command** - Must use join-with which is spatial, not structural

---

## Potential Solutions to Explore

### Solution A: Bottom-up with layout isolation
1. Process deepest containers first
2. After each join, explicitly re-set parent layout
3. Track and restore layouts at each level

### Solution B: Use vertical base layout
1. Start with v_tiles instead of h_tiles
2. Use `up/down` directions which create h_tiles containers
3. Then change to v_tiles where needed

### Solution C: Serialize and restore via aerospace commands
1. Check if aerospace has a "load layout" or "restore" command
2. Or use aerospace's configuration to define layouts

### Solution D: Multiple flatten-join cycles
1. Build one container at a time
2. Flatten other windows
3. Repeat for each container
4. Finally arrange containers

---

## Commands Reference

```bash
# Flatten all windows in workspace to single level
aerospace flatten-workspace-tree --workspace <name>

# Join window X with whatever is in direction
aerospace join-with --window-id <X> <left|right|up|down>

# Set layout type (affects focused window's container)
aerospace layout <h_tiles|v_tiles|h_accordion|v_accordion>

# Focus a specific window
aerospace focus --window-id <id>

# Move window to workspace
aerospace move-node-to-workspace --window-id <id> <workspace>

# List windows
aerospace list-windows --workspace <name> --format '%{window-id}|%{app-name}'

# Dump tree structure
aerospace dump-tree --workspace <name>
```

---

## Test Environment

- macOS with aerospace window manager
- Monitor: LG HDR 4K in portrait mode (2160x3840, rotated 270°)
- Custom `aerospace dump-tree` command from user's fork
- Test windows: Safari, multiple iTerm2 windows

---

## Phase 1 Atomic Tests Results (2025-01-28)

Automated test harness created: `aerospace-layout-tests.sh`

### Test 1.0: Workspace Memory Behavior
**Result**: ✅ CONFIRMED

Workspaces DO remember their layout type:
```bash
aerospace workspace test
aerospace layout v_accordion  # Set before moving windows
aerospace move-node-to-workspace --window-id X test
# Result: Root container is v_accordion
```

### Test 1.1: 3-Window h_tiles
**Result**: ✅ WORKS

Successfully creates h_tiles with 3+ windows:
```
container(h_tiles):
  window(A)
  window(B)
  window(C)
```

### Test 1.2: join-with left Creates v_tiles
**Result**: ✅ CONFIRMED

```
Before: h_tiles [A, B, C]
Command: focus A; join-with left (fails - nothing to left)
Command: focus C; join-with left (joins C with B)
After: h_tiles [A, v_tiles[B, C]]
```

**Critical Finding**: `join-with left/right` → creates **v_tiles** container

### Test 1.3: join-with down Creates h_tiles
**Result**: ⚠️ BLOCKED

Failed because "No windows in the specified direction":
- In v_tiles, windows are stacked vertically
- Focused window (first in list) has no window below it
- Must focus a different window to find one below

**Workaround**: Focus the UPPER window and `join-with down`, not vice versa.

### Test 1.4: Change Container Layout After Join
**Result**: ✅ WORKS

```
Before: container(h_tiles)
Command: aerospace layout h_accordion
After: container(h_accordion)
```

Layout change successfully changes the focused window's container layout.

### Test 1.5: Join 3 Windows into Same Container
**Result**: ⚠️ PARTIAL

```
Initial: h_tiles [A, B, C]
After join 1: h_tiles [v_tiles[A, B], C]  (A+B joined)
After join 2: h_tiles [v_tiles[A, B], C]  (C joins with the CONTAINER, not adding to it)
```

**Issue**: When joining a window with a container, it creates a NEW nested container instead of adding to existing.

**Solution**: Must use explicit window-to-window joins, then set layout.

### Test 1.6: Spatial Navigation
**Result**: ✅ INFORMATIVE

In h_tiles layout:
- `focus left` → finds neighbor ✓
- `focus right` → nothing (at rightmost)
- `focus up` → nothing
- `focus down` → nothing

**Conclusion**: Windows in h_tiles are arranged LEFT-to-RIGHT. Last window has neighbors to the LEFT only.

### Test 1.7: Focus Verification
**Result**: ✅ WORKS

`focus --window-id X` reliably focuses the correct window.

### Test 1.8: Opposite Orientation Rule
**Result**: ⚠️ NOT ENFORCED

Aerospace allowed same orientation nesting (v_accordion inside v_accordion). The normalization rule may only apply under certain conditions or may not be strictly enforced.

---

## Key Findings Summary

### Join Direction Rules (CONFIRMED)
| Join Direction | Creates Container |
|---------------|-------------------|
| `join-with left` | v_tiles |
| `join-with right` | v_tiles |
| `join-with up` | h_tiles |
| `join-with down` | h_tiles |

### Spatial Requirements
- `join-with` requires a window IN THAT DIRECTION
- Direction is spatial (based on screen position), not tree order
- Must focus the correct window to find a neighbor

### Window Order in h_tiles
```
[A, B, C] → A is leftmost, C is rightmost
- Focus C, join-with left → joins C with B
- Focus A, join-with left → FAILS (nothing to the left)
```

### Window Order in v_tiles
```
[A, B, C] → A is topmost, C is bottommost
- Focus A, join-with down → joins A with B
- Focus C, join-with down → FAILS (nothing below)
```

### Container Creation Pattern
To create a container with [A, B]:
1. Ensure A and B are spatially adjacent
2. Focus one of them
3. `join-with <direction-to-other>`
4. `layout <desired-layout>`

### Layout Changes Work
After creating a container with join-with, you CAN change its layout type using `aerospace layout`.

---

## Revised Algorithm Approach

Based on test findings, the algorithm should:

1. **Flatten workspace** - Put all windows at root level

2. **Set base layout** - Set the workspace layout (e.g., h_tiles for horizontal base)

3. **Process containers depth-first, children-first**:
   - Start with deepest nested containers
   - For each container, create it by joining windows
   - Set its layout type
   - Move up to parent level

4. **Use correct join directions**:
   - To create h_tiles/h_accordion: join vertically (up/down)
   - To create v_tiles/v_accordion: join horizontally (left/right)
   - BUT: direction must match spatial arrangement

5. **Focus correct window before join**:
   - In h_tiles parent: focus rightmost window of group, join-with left
   - In v_tiles parent: focus bottommost window of group, join-with up

---

## Next Steps

1. ✅ Phase 1 tests complete - atomic operations understood
2. ✅ Phase 2: Test 2-level nesting with standalone windows
3. ✅ Phase 3: Test 3-level nesting
4. ✅ Update aerospace-layout-from-dump.sh with findings

---

## Algorithm Implementation (2025-01-28)

### Working Algorithm for Layout Recreation

**Step 1: Window Discovery**
- Parse dump-tree JSON
- Find all windows by bundle-id AND title (exact match)
- Create mapping from original window-id to current window-id

**Step 2: Clear and Setup**
- Move all windows to temp workspace
- Switch to target workspace
- Move all windows to target workspace in DFS order
- Flatten workspace
- Set root layout

**Step 3: Create Nested Containers (Post-Order)**
- Process containers depth-first, children first (post-order traversal)
- Skip root container (its children are already at root level)
- For each nested container:
  1. Determine join direction based on ROOT layout (not target parent!)
  2. Focus first window of the group
  3. join-with <direction> for (num_children - 1) times
  4. Set the container's layout type

### Critical Algorithm Fix: Join Direction

**Problem discovered during 3-level nesting test:**
When creating nested containers, ALL windows are still at the FLATTENED ROOT level.
The ROOT layout determines spatial arrangement, NOT the target parent's layout.

**Wrong approach:**
```bash
# This fails for deeply nested containers
join_direction = based_on(target_parent_layout)
```

**Correct approach:**
```bash
# Always use root layout since windows are at root level
join_direction = based_on(root_layout)
```

**Example:**
Target: `v_tiles [h_tiles[A], h_tiles[B, v_tiles[C, D]]]`

When creating `v_tiles[C, D]`:
- C and D are at ROOT level with v_tiles layout (vertical)
- Target parent is h_tiles (horizontal)
- **Wrong**: Use right (h_tiles direction) → fails, no window to the right
- **Correct**: Use down (v_tiles direction) → finds D below C

### 2-Level Nesting Test Result

**Target:**
```
v_accordion:
  window(199): Xcode
  h_tiles:
    window(22135): App Store
    window(74): Calendar
  window(150): Code
  window(11599): Figma
```

**Result:** ✅ EXACT MATCH

The script successfully recreated the 2-level nested structure with:
- Correct root layout (v_accordion)
- Correct nested container layout (h_tiles)
- Correct window order within containers

### 3-Level Nesting Test

**Target:**
```
v_tiles:
  h_tiles:
    window(199): Xcode
    window(22135): App Store
  window(74): Calendar
  window(150): Code
  h_tiles:                          <- Level 2
    window(11599): Figma
    v_tiles:                        <- Level 3 (innermost)
      window(12090): Code
      window(17470): Code
```

**First attempt result:** ⚠️ Partial (3rd level failed)

The innermost v_tiles was not created because the algorithm used the
target parent layout (h_tiles → right) instead of the root layout
(v_tiles → down). Windows 12090 and 17470 are stacked vertically,
so `join-with right` found nothing.

**Fix applied:** Always pass and use root_layout for join direction.

**Second attempt result:** ⚠️ Partial (structure corruption)

After fix, the innermost v_tiles[12090, 17470] was created correctly.
However, the outer structure got corrupted:
- Root changed from v_tiles to h_tiles
- h_tiles[11599, v_tiles] was not created (join failed)

**Issue analysis:**
1. `aerospace layout` affects the focused window's PARENT container
2. When setting layout on newly created nested containers, it may also
   affect the root (opposite orientation rule enforcement)
3. After each nested container is created, the tree structure changes,
   affecting subsequent joins

**Solution: Two-Phase Approach**

Split the algorithm into two phases:
1. **Phase 1 (Join)**: Create all nested containers via join-with
   - No layout changes during this phase
   - Containers are created with aerospace's default layout (based on join direction)
2. **Phase 2 (Layout)**: Apply target layouts to all containers
   - Done after all structural changes are complete
   - Prevents layout changes from cascading and affecting joins

**Third attempt result:** ✅ EXACT MATCH

```
Expected:                           | Result:
v_tiles:                           | v_tiles:
  h_tiles [Xcode, App Store]       |   h_tiles [Xcode, App Store]
  Calendar                          |   Calendar
  Code                              |   Code
  h_tiles:                          |   h_tiles:
    Figma                           |     Figma
    v_tiles [Code, Code]            |     v_tiles [Code, Code]
```

The 3-level nested structure was perfectly recreated!

### Implementation Changes Made

1. **get_join_direction()**: Now uses "current_layout" parameter correctly
   - Comment clarified that this should be ROOT layout
   - Not the target parent's layout

2. **apply_layout()**: Phase 1 - Join only
   - Renamed `parent_layout` to `root_layout`
   - Pass root_layout unchanged to recursive calls
   - Use root_layout when calling get_join_direction()
   - NO LONGER sets layouts - just creates containers via joins

3. **apply_layouts()**: Phase 2 - Layout only (NEW)
   - New function for setting layouts after all joins complete
   - Post-order traversal like apply_layout
   - Only applies layouts, no structural changes

4. **main()**:
   - Pass root_layout to apply_layout()
   - Call apply_layouts() after apply_layout() completes

### Files Modified

- `aerospace-layout-from-dump.sh` - Main layout recreation script
- `aerospace-layout-tests.sh` - Test harness for atomic operations
- `LAYOUT_RECREATION_NOTES.md` - This documentation

---

## Final Working Algorithm Summary

```
1. Parse dump-tree JSON, create window mapping (original_id -> new_id)
2. Move all windows to temp workspace
3. Move all windows to target workspace in DFS order
4. Flatten workspace, set root layout
5. Phase 1 - Create containers (post-order traversal):
   For each non-root container:
     - Focus first window of container
     - join-with <direction> for (num_children - 1) times
     - Direction based on ROOT layout (all windows at root level)
6. Phase 2 - Apply layouts (post-order traversal):
   For each non-root container:
     - Focus first window
     - Set layout to target type
7. Done!
```

### Why Two-Phase Works

The single-phase approach failed because:
1. `aerospace layout` can cascade to parent containers (opposite orientation rule)
2. Layout changes alter the tree structure
3. Subsequent joins then fail because spatial arrangement changed

Two-phase avoids this by:
1. Completing ALL structural changes (joins) first
2. Then applying layouts when structure is stable
3. Even if layouts cascade, all containers already exist

---

## Containers with 3+ Windows (2025-01-28)

### The Problem

`join-with` always creates 2-element containers. When you try to add a third window:
- `join-with` extracts the focused window from its current container
- Creates a NEW 2-element container with the focused window and target
- The original container loses a member

**Example:**
```
[A, B, C] flat
join-with down → [h_tiles[A, B], C]
join-with down (from A inside container) → [B, h_tiles[A, C]]  # A extracted!
```

### The Solution: Use `move` to Add Windows

After `join-with` creates the initial 2-element container, use `move` to add remaining windows:

```bash
# Windows: [A, B, C, D] in v_tiles root
# Goal: Create h_tiles[A, B, C, D]

# Step 1: Join first two
aerospace focus --window-id A
aerospace join-with down
# Result: [h_tiles[A, B], C, D]

# Step 2: Move C into container
aerospace focus --window-id C
aerospace move up  # move TOWARD the container
# Result: [h_tiles[A, B, C], D]

# Step 3: Move D into container
aerospace focus --window-id D
aerospace move up
# Result: [h_tiles[A, B, C, D]]
```

### Move Direction Rules

The move direction should be TOWARD the container (opposite of join direction):
| Root Layout | Join Direction | Move Direction |
|-------------|----------------|----------------|
| v_tiles/v_accordion | down | up |
| h_tiles/h_accordion | right | left |

### Limitation: Window Order

The `move` command inserts windows at specific positions based on spatial arrangement, not at the end of the container. This means:
- The structural result is correct (all N windows in one container)
- The window ORDER within the container may differ from the target
- For tiles layouts, order affects which window is on which side
- For accordion layouts, order affects stacking sequence

**Example:**
```
Target:  h_tiles[A, B, C]
Actual:  h_tiles[A, C, B]  # Order differs due to move insertion point
```

### Implementation in Script

```bash
apply_layout() {
    # ...

    # Step 1: Join first two children to create the container
    aerospace focus --window-id "$first_window_id"
    aerospace join-with "$join_direction"

    # Step 2: For 3+ children, use MOVE to add remaining children
    if [[ "$num_children" -gt 2 ]]; then
        for each remaining child:
            aerospace focus --window-id "$target_window_id"
            aerospace move "$move_direction"  # opposite of join_direction
    fi
}
```

### Test Results

**7-window layout with 3-level nesting and 3-window container:**
```
Target:
v_accordion
├── h_tiles[Code(17470), Xcode(199), Code(149)]  ← 3 windows
├── Safari(113)
└── h_tiles[iTerm(4137), v_tiles[iTerm(17570), iTerm(20071)]]

Result:
v_accordion
├── h_tiles[Code(17470), Code(149), Xcode(199)]  ← Order differs
├── Safari(113)
└── h_tiles[iTerm(4137), v_tiles[iTerm(17570), iTerm(20071)]]
```

✅ Structure is correct (3-window container successfully created)
✅ Window order within 3-window container NOW FIXED (see below)

---

## Window Order Fix (2025-01-28)

### The Problem

When creating 3+ window containers, the order was wrong:
- Target: `h_tiles[Code(17470), Xcode(199), Code(149)]`
- Got: `h_tiles[Code(17470), Code(149), Xcode(199)]` - 2nd and 3rd swapped

### Root Cause

When `join-with <direction>` is executed:
- The **FOUND** window (in that direction) becomes **FIRST** in the container
- The **SOURCE** window (focused) becomes **SECOND**

Old algorithm for [A, B, C]:
1. Focus B (second-to-last), `join-with down` → finds C → creates `[C, B]`
2. Move A down into container → enters at position 0 → `[A, C, B]`

### The Solution

**Reverse the initial join direction:**

New algorithm for [A, B, C]:
1. Focus B (second), `join-with up` → finds A → creates `[A, B]`
2. Move C up into container → enters at END → `[A, B, C]` ✓

For containers with nested container children (already processed):
1. Focus first WINDOW (anchor), `join-with down`
2. This avoids extracting windows from nested containers

### Implementation

Added `get_opposite_join_direction()` function and modified `apply_layout()`:

```bash
# For windows-only containers: focus SECOND, join OPPOSITE direction
# For containers with nested containers: focus FIRST, join FORWARD direction
```

### Test Results

**Simple 3-window container:**
```
Target:  h_tiles[Brave, Xcode, Figma]
Result:  h_tiles[Brave, Xcode, Figma] ✓
```

**Complex 7-window with 3-level nesting:**
```
Target:                              Result:
v_accordion                          v_accordion
├── h_tiles[Brave,Xcode,Figma]       ├── h_tiles[Brave,Xcode,Figma] ✓
├── Calendar                         ├── Calendar                   ✓
└── h_tiles                          └── h_tiles                    ✓
    ├── AppStore                         ├── AppStore               ✓
    └── v_tiles[Mail,Messages]           └── v_tiles[Mail,Messages] ✓
```

### Verification: Window Matching

Windows are found by **bundle ID AND exact title match**:
```bash
find_window_by_bundle_and_title() {
    # Uses: aerospace list-windows --app-bundle-id "$bundle_id"
    # Then performs exact title match
}
```

This is working correctly. If windows aren't found, it's because titles changed since the dump was created
