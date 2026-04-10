/**
 * Tests for the moveNodeByFlatId store action — the single entry point
 * for all drag-and-drop tree mutations.
 *
 * Covers:
 *  (a) reorder within container
 *  (b) move between containers
 *  (d) drop into empty container
 *  (g) cycle prevention (can't drop parent into child)
 *  (h) root cannot be dragged but can receive drops
 *
 * Sidebar app drops (c), container body drops (e), auto-expand (f) are
 * UI-level behaviors tested in the Playwright e2e tests.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useEditorStore,
  assignNodeIds,
} from '../../src/store/editorStore';
import type { ContainerNode, WindowNode, TreeNode } from '../../src/types';

// --- Test helpers ---

function makeWindow(overrides: Partial<WindowNode> = {}): WindowNode {
  return {
    type: 'window',
    'app-bundle-id': 'com.test.App',
    'app-name': 'TestApp',
    startup: 'open -a TestApp',
    title: '',
    'window-id': 1,
    ...overrides,
  };
}

function makeContainer(
  children: TreeNode[] = [],
  overrides: Partial<ContainerNode> = {},
): ContainerNode {
  return {
    type: 'container',
    layout: 'h_accordion',
    orientation: 'horizontal',
    children,
    ...overrides,
  };
}

/**
 * Build a test tree:
 *   root (h_accordion, horizontal)
 *     ├── w-0: VS Code
 *     ├── c-1 (v_tiles, vertical)
 *     │   ├── w-0: iTerm2
 *     │   └── w-1: Safari
 *     ├── w-2: Slack
 *     └── c-3 (v_accordion, vertical) — empty container
 */
function makeTestTree(): ContainerNode {
  return makeContainer([
    makeWindow({ 'app-bundle-id': 'com.microsoft.VSCode', 'app-name': 'VS Code', 'window-id': 1 }),
    makeContainer(
      [
        makeWindow({ 'app-bundle-id': 'com.googlecode.iterm2', 'app-name': 'iTerm2', 'window-id': 2 }),
        makeWindow({ 'app-bundle-id': 'com.apple.Safari', 'app-name': 'Safari', 'window-id': 3 }),
      ],
      { layout: 'v_tiles', orientation: 'vertical' },
    ),
    makeWindow({ 'app-bundle-id': 'com.tinyspeck.slackmacgap', 'app-name': 'Slack', 'window-id': 4 }),
    makeContainer([], { layout: 'v_accordion', orientation: 'vertical' }),
  ]);
}

/** Get child app names at a container level */
function childNames(container: ContainerNode): string[] {
  return container.children.map((c) =>
    c.type === 'window' ? c['app-name'] : `[${c.layout}]`,
  );
}

// --- Tests ---

describe('moveNodeByFlatId', () => {
  beforeEach(() => {
    useEditorStore.setState({
      tree: null,
      selectedNodeId: null,
      collapsedIds: new Set(),
      undoStack: [],
      redoStack: [],
      activeMode: null,
      activeWorkspace: null,
    });
  });

  function initTree() {
    const tree = makeTestTree();
    useEditorStore.getState().setTree(tree);
    return useEditorStore.getState().tree!;
  }

  // (a) Reorder within container
  describe('reorder within container', () => {
    it('moves a node forward within the same parent', () => {
      initTree();

      // Move VS Code (root/w-0) to after Slack (root/w-2)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-0',
        targetId: 'root/w-2',
        dropType: 'after',
      });

      const tree = useEditorStore.getState().tree!;
      // Original order: VS Code, [v_tiles], Slack, [v_accordion]
      // After moving VS Code after Slack: [v_tiles], Slack, VS Code, [v_accordion]
      expect(childNames(tree)).toEqual(['[v_tiles]', 'Slack', 'VS Code', '[v_accordion]']);
      expect(useEditorStore.getState().undoStack).toHaveLength(1);
    });

    it('moves a node backward within the same parent', () => {
      initTree();

      // Move Slack (root/w-2) before VS Code (root/w-0)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-2',
        targetId: 'root/w-0',
        dropType: 'before',
      });

      const tree = useEditorStore.getState().tree!;
      // Original: VS Code, [v_tiles], Slack, [v_accordion]
      // After: Slack, VS Code, [v_tiles], [v_accordion]
      expect(childNames(tree)).toEqual(['Slack', 'VS Code', '[v_tiles]', '[v_accordion]']);
    });

    it('is a no-op when source and target positions are the same', () => {
      initTree();
      const treeBefore = useEditorStore.getState().tree;

      // Move VS Code (root/w-0) before itself — should be no-op
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-0',
        targetId: 'root/w-0',
        dropType: 'before',
      });

      // No undo pushed for no-op
      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    });

    it('reorders children within a nested container', () => {
      initTree();

      // Move Safari (root/c-1/w-1) before iTerm2 (root/c-1/w-0)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/c-1/w-1',
        targetId: 'root/c-1/w-0',
        dropType: 'before',
      });

      const tree = useEditorStore.getState().tree!;
      const innerContainer = tree.children[1] as ContainerNode;
      expect(childNames(innerContainer)).toEqual(['Safari', 'iTerm2']);
    });
  });

  // (b) Move between containers
  describe('move between containers', () => {
    it('moves a window from root into a nested container (inside)', () => {
      initTree();

      // Move Slack (root/w-2) inside v_tiles container (root/c-1)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-2',
        targetId: 'root/c-1',
        dropType: 'inside',
      });

      const tree = useEditorStore.getState().tree!;
      // Root lost Slack: VS Code, [v_tiles], [v_accordion]
      expect(tree.children).toHaveLength(3);
      const innerContainer = tree.children[1] as ContainerNode;
      // Inner gained Slack at end: iTerm2, Safari, Slack
      expect(innerContainer.children).toHaveLength(3);
      expect(childNames(innerContainer)).toEqual(['iTerm2', 'Safari', 'Slack']);
    });

    it('moves a window from nested container to root (before)', () => {
      initTree();

      // Move iTerm2 (root/c-1/w-0) before VS Code (root/w-0)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/c-1/w-0',
        targetId: 'root/w-0',
        dropType: 'before',
      });

      const tree = useEditorStore.getState().tree!;
      // Root gained iTerm2: iTerm2, VS Code, [v_tiles](now has 1 child), Slack, [v_accordion]
      expect(tree.children).toHaveLength(5);
      expect((tree.children[0] as WindowNode)['app-name']).toBe('iTerm2');
      const innerContainer = tree.children[2] as ContainerNode;
      expect(innerContainer.children).toHaveLength(1);
      expect(childNames(innerContainer)).toEqual(['Safari']);
    });

    it('moves a window to after a node in a different container', () => {
      initTree();

      // Move VS Code (root/w-0) after iTerm2 (root/c-1/w-0) in the nested container
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-0',
        targetId: 'root/c-1/w-0',
        dropType: 'after',
      });

      const tree = useEditorStore.getState().tree!;
      // Root lost VS Code
      expect(tree.children).toHaveLength(3);
      const innerContainer = tree.children[0] as ContainerNode;
      // Inner now has: iTerm2, VS Code, Safari
      expect(childNames(innerContainer)).toEqual(['iTerm2', 'VS Code', 'Safari']);
    });
  });

  // (d) Drop into empty container
  describe('drop into empty container', () => {
    it('drops a node inside an empty container', () => {
      initTree();

      // Move VS Code (root/w-0) inside the empty v_accordion (root/c-3)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-0',
        targetId: 'root/c-3',
        dropType: 'inside',
      });

      const tree = useEditorStore.getState().tree!;
      // Root: [v_tiles], Slack, [v_accordion](now has VS Code)
      expect(tree.children).toHaveLength(3);
      const emptyBefore = tree.children[2] as ContainerNode;
      expect(emptyBefore.children).toHaveLength(1);
      expect((emptyBefore.children[0] as WindowNode)['app-name']).toBe('VS Code');
    });
  });

  // (g) Cycle prevention
  describe('cycle prevention', () => {
    it('prevents dropping a container into its own child (direct)', () => {
      initTree();

      // Try to move root into root/c-1 — should be blocked (root can't be dragged anyway)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root',
        targetId: 'root/c-1',
        dropType: 'inside',
      });

      // No change (root can't be dragged)
      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    });

    it('prevents dropping a container into a nested descendant', () => {
      // Build a deeper tree: root > container A > container B
      const deepTree = makeContainer([
        makeContainer(
          [
            makeContainer(
              [makeWindow({ 'app-name': 'Deep', 'window-id': 10 })],
              { layout: 'v_tiles', orientation: 'vertical' },
            ),
          ],
          { layout: 'v_accordion', orientation: 'vertical' },
        ),
        makeWindow({ 'app-name': 'TopLevel', 'window-id': 11 }),
      ]);
      useEditorStore.getState().setTree(deepTree);

      // Try to move container A (root/c-0) inside its grandchild container B (root/c-0/c-0)
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/c-0',
        targetId: 'root/c-0/c-0',
        dropType: 'inside',
      });

      // Cycle prevention should block this — no undo pushed
      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    });
  });

  // (h) Root cannot be dragged but can receive drops
  describe('root node behavior', () => {
    it('does not allow dragging the root node', () => {
      initTree();

      // Try to move root somewhere — should be blocked
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root',
        targetId: 'root/w-0',
        dropType: 'before',
      });

      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    });

    it('allows dropping nodes inside root (root as drop target)', () => {
      initTree();

      // Move iTerm2 from nested container into root
      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/c-1/w-0',
        targetId: 'root',
        dropType: 'inside',
      });

      const tree = useEditorStore.getState().tree!;
      // Root gained iTerm2 at end: VS Code, [v_tiles](now 1 child), Slack, [v_accordion], iTerm2
      expect(tree.children).toHaveLength(5);
      expect((tree.children[4] as WindowNode)['app-name']).toBe('iTerm2');
    });
  });

  // Undo integration
  describe('undo integration', () => {
    it('pushes undo before every mutation', () => {
      initTree();

      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/w-0',
        targetId: 'root/c-1',
        dropType: 'inside',
      });

      expect(useEditorStore.getState().undoStack).toHaveLength(1);

      // Undo should restore
      useEditorStore.getState().undo();
      const tree = useEditorStore.getState().tree!;
      expect(tree.children).toHaveLength(4);
      expect(childNames(tree)).toEqual(['VS Code', '[v_tiles]', 'Slack', '[v_accordion]']);
    });
  });

  // Orientation normalization
  describe('orientation normalization', () => {
    it('normalizes container orientation when moved to a different parent', () => {
      // Create a tree where moving a container would cause a same-orientation conflict
      // root (h_accordion, horizontal)
      //   ├── c-0 (h_tiles, horizontal) — should be corrected to vertical when inside root
      //   │   └── w-0: App
      //   └── c-1 (v_tiles, vertical)
      //       └── w-0: App2
      //
      // Moving c-0 inside c-1 (which is v_tiles): c-0 should become h_tiles (opposite)
      const tree = makeContainer([
        makeContainer(
          [makeWindow({ 'app-name': 'App', 'window-id': 1 })],
          { layout: 'h_tiles', orientation: 'horizontal' },
        ),
        makeContainer(
          [makeWindow({ 'app-name': 'App2', 'window-id': 2 })],
          { layout: 'v_tiles', orientation: 'vertical' },
        ),
      ]);
      useEditorStore.getState().setTree(tree);

      useEditorStore.getState().moveNodeByFlatId({
        sourceId: 'root/c-0',
        targetId: 'root/c-1',
        dropType: 'inside',
      });

      const result = useEditorStore.getState().tree!;
      const targetContainer = result.children[0] as ContainerNode;
      const movedContainer = targetContainer.children[1] as ContainerNode;
      // v_tiles parent enforces horizontal children, so h_tiles is correct (opposite of vertical)
      expect(movedContainer.layout).toBe('h_tiles');
      expect(movedContainer.orientation).toBe('horizontal');
    });
  });
});
