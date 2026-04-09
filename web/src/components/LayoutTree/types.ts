import type { TreeNode } from '../../types';

/**
 * A flattened representation of a tree node for use with dnd-kit's flat sortable list.
 * The nested tree is converted to this flat format for rendering, with depth information
 * used for visual indentation.
 */
export interface FlatNode {
  /** Unique ID for dnd-kit (e.g., "container-0", "window-1-2") */
  id: string;
  /** The actual tree node data */
  node: TreeNode;
  /** Nesting depth (0 = root container) */
  depth: number;
  /** ID of the parent FlatNode, or null for root */
  parentId: string | null;
  /** Index within parent's children array */
  index: number;
  /** Whether this container's children are hidden */
  isCollapsed: boolean;
}
