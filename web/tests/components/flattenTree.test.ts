/**
 * Tests for tree utility functions (flattenTree, reorderWithinParent,
 * moveNodeBetweenContainers).
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import {
  flattenTree,
  reorderWithinParent,
  moveNodeBetweenContainers,
} from '../../src/components/LayoutTree/FlatSortable/flattenTree';
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
 *   root (h_accordion)
 *     ├── window: VS Code (index 0)
 *     ├── container (v_tiles) (index 1)
 *     │   ├── window: iTerm2 (index 0)
 *     │   └── window: Safari (index 1)
 *     └── window: Slack (index 2)
 */
function makeTestTree(): ContainerNode {
  return makeContainer([
    makeWindow({ 'app-name': 'VS Code', 'window-id': 1 }),
    makeContainer(
      [
        makeWindow({ 'app-name': 'iTerm2', 'window-id': 2 }),
        makeWindow({ 'app-name': 'Safari', 'window-id': 3 }),
      ],
      { layout: 'v_tiles', orientation: 'vertical' },
    ),
    makeWindow({ 'app-name': 'Slack', 'window-id': 4 }),
  ]);
}

// --- flattenTree tests ---

describe('flattenTree', () => {
  it('produces correct flat list from nested tree', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    // Expected order: root, VS Code, inner container, iTerm2, Safari, Slack
    expect(flat).toHaveLength(6);
    expect(flat[0].id).toBe('root');
    expect(flat[0].node.type).toBe('container');
    expect(flat[0].depth).toBe(0);
    expect(flat[0].parentId).toBeNull();
  });

  it('assigns correct depth values at each level', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    // root: depth 0
    expect(flat[0].depth).toBe(0);
    // VS Code: depth 1
    expect(flat[1].depth).toBe(1);
    expect(flat[1].node.type).toBe('window');
    // Inner container: depth 1
    expect(flat[2].depth).toBe(1);
    expect(flat[2].node.type).toBe('container');
    // iTerm2: depth 2
    expect(flat[3].depth).toBe(2);
    // Safari: depth 2
    expect(flat[4].depth).toBe(2);
    // Slack: depth 1
    expect(flat[5].depth).toBe(1);
  });

  it('assigns correct parentId values', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    expect(flat[0].parentId).toBeNull(); // root
    expect(flat[1].parentId).toBe('root'); // VS Code
    expect(flat[2].parentId).toBe('root'); // inner container
    expect(flat[3].parentId).toBe(flat[2].id); // iTerm2 -> inner container
    expect(flat[4].parentId).toBe(flat[2].id); // Safari -> inner container
    expect(flat[5].parentId).toBe('root'); // Slack
  });

  it('assigns correct index values', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    expect(flat[0].index).toBe(0); // root
    expect(flat[1].index).toBe(0); // VS Code (first child of root)
    expect(flat[2].index).toBe(1); // inner container (second child of root)
    expect(flat[3].index).toBe(0); // iTerm2 (first child of inner)
    expect(flat[4].index).toBe(1); // Safari (second child of inner)
    expect(flat[5].index).toBe(2); // Slack (third child of root)
  });

  it('collapsed containers hide their children', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    // Get the inner container's ID to collapse it
    const innerContainerId = flat[2].id;

    const collapsed = flattenTree(tree, new Set([innerContainerId]));

    // Should have: root, VS Code, inner container (collapsed), Slack
    // iTerm2 and Safari are hidden
    expect(collapsed).toHaveLength(4);
    expect(collapsed[2].id).toBe(innerContainerId);
    expect(collapsed[2].isCollapsed).toBe(true);
    expect(collapsed[3].node.type).toBe('window'); // Slack
  });

  it('collapsing root hides all children', () => {
    const tree = makeTestTree();
    const collapsed = flattenTree(tree, new Set(['root']));

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe('root');
    expect(collapsed[0].isCollapsed).toBe(true);
  });

  it('handles an empty container', () => {
    const tree = makeContainer([]);
    const flat = flattenTree(tree, new Set());

    expect(flat).toHaveLength(1);
    expect(flat[0].id).toBe('root');
  });
});

// --- reorderWithinParent tests ---

describe('reorderWithinParent', () => {
  it('reorders children correctly within the same parent', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    // Move VS Code (index 0) to Slack's position (index 2)
    const vsCodeId = flat[1].id;  // VS Code
    const slackId = flat[5].id;   // Slack

    const newTree = reorderWithinParent(tree, flat, vsCodeId, slackId);

    // VS Code should now be at position 2 (after Slack's original position)
    expect(newTree.children[0].type).toBe('container'); // inner container moved up
    expect((newTree.children[1] as WindowNode)['app-name']).toBe('Slack');
    expect((newTree.children[2] as WindowNode)['app-name']).toBe('VS Code');
  });

  it('returns original tree when activeId equals overId', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const vsCodeId = flat[1].id;
    const result = reorderWithinParent(tree, flat, vsCodeId, vsCodeId);

    // Should return original (no-op when same index)
    expect(result).toBe(tree);
  });

  it('returns original tree when nodes have different parents', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const vsCodeId = flat[1].id;   // child of root
    const itermId = flat[3].id;    // child of inner container

    const result = reorderWithinParent(tree, flat, vsCodeId, itermId);
    expect(result).toBe(tree); // no-op for cross-parent
  });

  it('returns original tree when trying to move the root', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const rootId = flat[0].id;
    const vsCodeId = flat[1].id;

    const result = reorderWithinParent(tree, flat, rootId, vsCodeId);
    expect(result).toBe(tree);
  });
});

// --- moveNodeBetweenContainers tests ---

describe('moveNodeBetweenContainers', () => {
  it('moves a node from one container to another', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const slackId = flat[5].id;          // Slack (child of root)
    const innerContainerId = flat[2].id; // inner container

    // Drop Slack onto the inner container -> should add as last child
    const newTree = moveNodeBetweenContainers(tree, flat, slackId, innerContainerId);

    expect(newTree.children).toHaveLength(2); // root lost Slack
    const inner = newTree.children[1] as ContainerNode;
    expect(inner.children).toHaveLength(3); // gained Slack
    expect((inner.children[2] as WindowNode)['app-name']).toBe('Slack');
  });

  it('moves a node to a different position next to a window in another container', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const slackId = flat[5].id;   // Slack (child of root)
    const itermId = flat[3].id;   // iTerm2 (child of inner)

    // Drop Slack onto iTerm2 -> should insert at iTerm2's index in inner container
    const newTree = moveNodeBetweenContainers(tree, flat, slackId, itermId);

    expect(newTree.children).toHaveLength(2); // root lost Slack
    const inner = newTree.children[1] as ContainerNode;
    expect(inner.children).toHaveLength(3); // gained Slack
    // Slack should be at iTerm2's original index (0)
    expect((inner.children[0] as WindowNode)['app-name']).toBe('Slack');
  });

  it('returns original tree when trying to move the root', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const rootId = flat[0].id;
    const vsCodeId = flat[1].id;

    const result = moveNodeBetweenContainers(tree, flat, rootId, vsCodeId);
    expect(result).toBe(tree);
  });

  it('returns original tree when active or over node not found', () => {
    const tree = makeTestTree();
    const flat = flattenTree(tree, new Set());

    const result = moveNodeBetweenContainers(tree, flat, 'nonexistent', flat[1].id);
    expect(result).toBe(tree);
  });
});
