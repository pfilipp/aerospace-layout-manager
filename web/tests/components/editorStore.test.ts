/**
 * Tests for the Zustand editor store (src/store/editorStore.ts).
 *
 * Tests store actions directly — no React rendering needed.
 * Uses useEditorStore.getState() and useEditorStore.setState() for
 * synchronous access to the store.
 */

// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import {
  useEditorStore,
  assignNodeIds,
  pushUndo,
} from '../../src/store/editorStore';
import type { ContainerNode, TreeNode, WindowNode } from '../../src/types';

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

/** Build a simple test tree:
 *  root (h_accordion)
 *    ├── window: VS Code
 *    ├── container (v_tiles)
 *    │   ├── window: iTerm2
 *    │   └── window: Safari
 *    └── window: Slack
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
  ]);
}

/** Get the _nodeId from a tree node */
function getNodeId(node: TreeNode): string {
  return (node as unknown as Record<string, unknown>)['_nodeId'] as string;
}

/** Get all _nodeIds from a tree recursively */
function collectNodeIds(node: TreeNode): string[] {
  const ids: string[] = [];
  const id = getNodeId(node);
  if (id) ids.push(id);
  if (node.type === 'container') {
    for (const child of node.children) {
      ids.push(...collectNodeIds(child));
    }
  }
  return ids;
}

// --- Tests ---

describe('editorStore', () => {
  beforeEach(() => {
    // Reset store to initial state between tests
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

  describe('setTree', () => {
    it('sets the tree and assigns node IDs', () => {
      const tree = makeTestTree();
      useEditorStore.getState().setTree(tree);

      const state = useEditorStore.getState();
      expect(state.tree).not.toBeNull();
      expect(state.tree!.type).toBe('container');

      // Every node should have a _nodeId
      const ids = collectNodeIds(state.tree!);
      // root container, VS Code window, inner container, iTerm2 window, Safari window, Slack window = 6
      expect(ids.length).toBe(6);
    });

    it('clears undo and redo stacks', () => {
      // Pre-populate stacks
      useEditorStore.setState({
        undoStack: [makeContainer()],
        redoStack: [makeContainer()],
      });

      useEditorStore.getState().setTree(makeTestTree());

      const state = useEditorStore.getState();
      expect(state.undoStack).toHaveLength(0);
      expect(state.redoStack).toHaveLength(0);
    });

    it('clears selectedNodeId and collapsedIds', () => {
      useEditorStore.setState({
        selectedNodeId: 'some-id',
        collapsedIds: new Set(['id1', 'id2']),
      });

      useEditorStore.getState().setTree(makeTestTree());

      const state = useEditorStore.getState();
      expect(state.selectedNodeId).toBeNull();
      expect(state.collapsedIds.size).toBe(0);
    });
  });

  describe('selectNode', () => {
    it('updates selectedNodeId', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);

      useEditorStore.getState().selectNode(rootId);
      expect(useEditorStore.getState().selectedNodeId).toBe(rootId);
    });

    it('can set selectedNodeId to null', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);

      useEditorStore.getState().selectNode(rootId);
      useEditorStore.getState().selectNode(null);
      expect(useEditorStore.getState().selectedNodeId).toBeNull();
    });
  });

  describe('toggleCollapse', () => {
    it('adds an ID to collapsedIds', () => {
      useEditorStore.getState().toggleCollapse('test-id');
      expect(useEditorStore.getState().collapsedIds.has('test-id')).toBe(true);
    });

    it('removes an ID from collapsedIds on second toggle', () => {
      useEditorStore.getState().toggleCollapse('test-id');
      useEditorStore.getState().toggleCollapse('test-id');
      expect(useEditorStore.getState().collapsedIds.has('test-id')).toBe(false);
    });
  });

  describe('addNode', () => {
    it('adds a child to the specified parent and pushes undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const state = useEditorStore.getState();
      const rootId = getNodeId(state.tree!);

      const newWindow = makeWindow({
        'app-bundle-id': 'com.brave.Browser',
        'app-name': 'Brave',
        'window-id': 99,
      });

      useEditorStore.getState().addNode(rootId, newWindow);

      const updated = useEditorStore.getState();
      expect(updated.tree!.children).toHaveLength(4); // was 3
      expect(updated.undoStack).toHaveLength(1);
      expect(updated.redoStack).toHaveLength(0);

      const lastChild = updated.tree!.children[3];
      expect(lastChild.type).toBe('window');
      expect((lastChild as WindowNode)['app-name']).toBe('Brave');
    });
  });

  describe('deleteNode', () => {
    it('removes a node and pushes undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const state = useEditorStore.getState();

      // Delete the first child (VS Code window)
      const vsCodeId = getNodeId(state.tree!.children[0]);
      useEditorStore.getState().deleteNode(vsCodeId);

      const updated = useEditorStore.getState();
      expect(updated.tree!.children).toHaveLength(2); // was 3
      expect(updated.undoStack).toHaveLength(1);
    });

    it('clears selectedNodeId if deleted node was selected', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const vsCodeId = getNodeId(useEditorStore.getState().tree!.children[0]);

      useEditorStore.getState().selectNode(vsCodeId);
      useEditorStore.getState().deleteNode(vsCodeId);

      expect(useEditorStore.getState().selectedNodeId).toBeNull();
    });

    it('does not delete the root node', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);

      useEditorStore.getState().deleteNode(rootId);

      // Root should still be there, no undo pushed
      expect(useEditorStore.getState().tree!.children).toHaveLength(3);
      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    });
  });

  describe('duplicateNode', () => {
    it('creates a copy adjacent to the original and pushes undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const vsCodeId = getNodeId(useEditorStore.getState().tree!.children[0]);

      useEditorStore.getState().duplicateNode(vsCodeId);

      const updated = useEditorStore.getState();
      expect(updated.tree!.children).toHaveLength(4); // was 3
      expect(updated.undoStack).toHaveLength(1);

      // Duplicate should be at index 1
      const dup = updated.tree!.children[1] as WindowNode;
      expect(dup.type).toBe('window');
      expect(dup['app-name']).toBe('VS Code');
      // The original at index 0 should still be VS Code
      const orig = updated.tree!.children[0] as WindowNode;
      expect(orig['app-name']).toBe('VS Code');
    });

    it('does not duplicate the root node', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);

      useEditorStore.getState().duplicateNode(rootId);

      expect(useEditorStore.getState().tree!.children).toHaveLength(3);
      expect(useEditorStore.getState().undoStack).toHaveLength(0);
    });
  });

  describe('wrapNodes', () => {
    it('wraps nodes in a new container and pushes undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const tree = useEditorStore.getState().tree!;

      const vsCodeId = getNodeId(tree.children[0]);
      const slackId = getNodeId(tree.children[2]);

      useEditorStore.getState().wrapNodes([vsCodeId, slackId], 'v_tiles');

      const updated = useEditorStore.getState();
      // Root had 3 children (VS Code, container, Slack). After wrapping VS Code + Slack:
      // Root now has 2 children: wrapper container (at index 0), inner container (at index 1)
      expect(updated.tree!.children).toHaveLength(2);
      expect(updated.undoStack).toHaveLength(1);

      const wrapper = updated.tree!.children[0] as ContainerNode;
      expect(wrapper.type).toBe('container');
      expect(wrapper.layout).toBe('v_tiles');
      expect(wrapper.orientation).toBe('vertical');
      expect(wrapper.children).toHaveLength(2);
    });

    it('does not wrap nodes from different parents', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const tree = useEditorStore.getState().tree!;

      const vsCodeId = getNodeId(tree.children[0]);
      const innerContainer = tree.children[1] as ContainerNode;
      const itermId = getNodeId(innerContainer.children[0]);

      useEditorStore.getState().wrapNodes([vsCodeId, itermId], 'h_tiles');

      // Should not have changed since nodes are in different parents
      const updated = useEditorStore.getState();
      expect(updated.tree!.children).toHaveLength(3);
      expect(updated.undoStack).toHaveLength(0);
    });
  });

  describe('updateNode', () => {
    it('updates node properties and pushes undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const vsCodeId = getNodeId(useEditorStore.getState().tree!.children[0]);

      useEditorStore.getState().updateNode(vsCodeId, {
        'app-name': 'Visual Studio Code',
        startup: 'code ~/new-project',
      } as Partial<TreeNode>);

      const updated = useEditorStore.getState();
      const vsCode = updated.tree!.children[0] as WindowNode;
      expect(vsCode['app-name']).toBe('Visual Studio Code');
      expect(vsCode.startup).toBe('code ~/new-project');
      expect(updated.undoStack).toHaveLength(1);
    });

    it('updates container layout type', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);

      useEditorStore.getState().updateNode(rootId, {
        layout: 'v_accordion',
      } as Partial<TreeNode>);

      const updated = useEditorStore.getState();
      expect(updated.tree!.layout).toBe('v_accordion');
      expect(updated.undoStack).toHaveLength(1);
    });
  });

  describe('moveNode', () => {
    it('moves a node to a new parent and position, pushes undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const tree = useEditorStore.getState().tree!;

      // Move Slack (index 2 in root) into the inner container
      const slackId = getNodeId(tree.children[2]);
      const innerContainerId = getNodeId(tree.children[1]);

      useEditorStore.getState().moveNode(slackId, innerContainerId, 0);

      const updated = useEditorStore.getState();
      expect(updated.tree!.children).toHaveLength(2); // root lost Slack
      expect(updated.undoStack).toHaveLength(1);

      const innerContainer = updated.tree!.children[1] as ContainerNode;
      expect(innerContainer.children).toHaveLength(3); // gained Slack at index 0
      expect((innerContainer.children[0] as WindowNode)['app-name']).toBe('Slack');
    });
  });

  describe('undo', () => {
    it('reverts to the previous state and pushes to redo', () => {
      useEditorStore.getState().setTree(makeTestTree());

      // Make a change
      const vsCodeId = getNodeId(useEditorStore.getState().tree!.children[0]);
      useEditorStore.getState().deleteNode(vsCodeId);
      expect(useEditorStore.getState().tree!.children).toHaveLength(2);

      // Undo
      useEditorStore.getState().undo();

      const state = useEditorStore.getState();
      expect(state.tree!.children).toHaveLength(3); // restored
      expect(state.undoStack).toHaveLength(0);
      expect(state.redoStack).toHaveLength(1);
    });

    it('does nothing when undo stack is empty', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const treeBefore = useEditorStore.getState().tree;

      useEditorStore.getState().undo();

      expect(useEditorStore.getState().tree).toBe(treeBefore);
    });
  });

  describe('redo', () => {
    it('re-applies undone change and pushes to undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const vsCodeId = getNodeId(useEditorStore.getState().tree!.children[0]);

      // Delete, then undo, then redo
      useEditorStore.getState().deleteNode(vsCodeId);
      useEditorStore.getState().undo();
      useEditorStore.getState().redo();

      const state = useEditorStore.getState();
      expect(state.tree!.children).toHaveLength(2); // delete re-applied
      expect(state.undoStack).toHaveLength(1);
      expect(state.redoStack).toHaveLength(0);
    });

    it('does nothing when redo stack is empty', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const treeBefore = useEditorStore.getState().tree;

      useEditorStore.getState().redo();

      expect(useEditorStore.getState().tree).toBe(treeBefore);
    });
  });

  describe('undo after new mutation clears redo stack', () => {
    it('clears redo stack when a new mutation is performed after undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const vsCodeId = getNodeId(useEditorStore.getState().tree!.children[0]);

      // Delete -> undo (redo stack has 1 entry)
      useEditorStore.getState().deleteNode(vsCodeId);
      useEditorStore.getState().undo();
      expect(useEditorStore.getState().redoStack).toHaveLength(1);

      // Now do a new mutation -> redo stack should be cleared
      const newWindow = makeWindow({ 'app-name': 'Brave', 'window-id': 99 });
      const rootId = getNodeId(useEditorStore.getState().tree!);
      useEditorStore.getState().addNode(rootId, newWindow);

      expect(useEditorStore.getState().redoStack).toHaveLength(0);
    });
  });

  describe('undo stack cap', () => {
    it('caps undo stack at 50 entries', () => {
      useEditorStore.getState().setTree(makeTestTree());

      // Perform 55 mutations
      for (let i = 0; i < 55; i++) {
        const rootId = getNodeId(useEditorStore.getState().tree!);
        const newWindow = makeWindow({ 'app-name': `App${i}`, 'window-id': 100 + i });
        useEditorStore.getState().addNode(rootId, newWindow);
      }

      expect(useEditorStore.getState().undoStack.length).toBeLessThanOrEqual(50);
    });
  });

  describe('canUndo / canRedo', () => {
    it('reports false initially', () => {
      useEditorStore.getState().setTree(makeTestTree());
      expect(useEditorStore.getState().canUndo()).toBe(false);
      expect(useEditorStore.getState().canRedo()).toBe(false);
    });

    it('reports canUndo true after mutation', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);
      useEditorStore.getState().addNode(rootId, makeWindow());

      expect(useEditorStore.getState().canUndo()).toBe(true);
      expect(useEditorStore.getState().canRedo()).toBe(false);
    });

    it('reports canRedo true after undo', () => {
      useEditorStore.getState().setTree(makeTestTree());
      const rootId = getNodeId(useEditorStore.getState().tree!);
      useEditorStore.getState().addNode(rootId, makeWindow());
      useEditorStore.getState().undo();

      expect(useEditorStore.getState().canUndo()).toBe(false);
      expect(useEditorStore.getState().canRedo()).toBe(true);
    });
  });

  describe('pushUndo helper', () => {
    it('caps the stack at 50', () => {
      const tree = makeContainer();
      const bigStack: ContainerNode[] = Array.from({ length: 50 }, () => makeContainer());

      const result = pushUndo(tree, bigStack);
      expect(result.undoStack).toHaveLength(50);
      expect(result.redoStack).toHaveLength(0);
    });

    it('clears redo stack', () => {
      const tree = makeContainer();
      const result = pushUndo(tree, []);
      expect(result.redoStack).toHaveLength(0);
    });
  });
});
