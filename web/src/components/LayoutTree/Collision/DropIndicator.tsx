/**
 * Visual drop indicators for the drag-and-drop tree editor.
 *
 * Two indicator types:
 * 1. BetweenIndicator: a horizontal line showing where a node will be inserted
 *    between siblings (renders for 'before' and 'after' drop targets).
 * 2. ContainerHighlight: a highlight/outline on a container when a node will
 *    be dropped inside it (renders for 'inside' drop targets).
 *
 * These are rendered as absolutely-positioned overlays on top of tree nodes.
 */

import type { DropTarget } from './types';

const INDENT_PX = 24;

interface DropIndicatorProps {
  /** The current drop target, or null when not dragging over anything */
  dropTarget: DropTarget | null;
  /** The FlatNode ID of the node this indicator is attached to */
  nodeId: string;
  /** Depth of the node (for indentation) */
  depth: number;
  /** Whether this node is a container */
  isContainer: boolean;
  /** Parent container's flat ID (for showing insertion within parent) */
  parentId?: string | null;
  /** Index within parent's children */
  indexInParent?: number;
}

/**
 * Renders a drop indicator relative to a specific tree node.
 * Place this component inside each tree node's wrapper.
 * It renders when:
 * 1. The dropTarget matches this node's ID directly (before/after/inside)
 * 2. This node is a child of the targeted container at the insertion index
 */
export function DropIndicator({
  dropTarget,
  nodeId,
  depth,
  isContainer,
  parentId,
  indexInParent,
}: DropIndicatorProps) {
  if (!dropTarget) return null;

  // Direct target match
  if (dropTarget.targetId === nodeId) {
    if (dropTarget.type === 'inside' && isContainer) {
      return <ContainerHighlight depth={depth} />;
    }

    if (dropTarget.type === 'before') {
      return <BetweenIndicator position="top" depth={depth} />;
    }

    if (dropTarget.type === 'after') {
      return <BetweenIndicator position="bottom" depth={depth} />;
    }
  }

  // Insertion indicator within a container: show a "before" line on the child
  // at the insertion index when the parent container is the drop target
  if (
    dropTarget.type === 'inside' &&
    dropTarget.insertIndex !== undefined &&
    parentId === dropTarget.targetId &&
    indexInParent === dropTarget.insertIndex
  ) {
    return <BetweenIndicator position="top" depth={depth} />;
  }

  return null;
}

/**
 * A horizontal line indicator showing insertion point between siblings.
 * Renders at the top or bottom edge of the node.
 */
function BetweenIndicator({
  position,
  depth,
}: {
  position: 'top' | 'bottom';
  depth: number;
}) {
  const leftOffset = depth * INDENT_PX + 8;

  return (
    <div
      className="absolute pointer-events-none z-40"
      style={{
        left: leftOffset,
        right: 8,
        [position]: -1,
        height: 2,
      }}
    >
      {/* The line */}
      <div className="w-full h-0.5 bg-blue-500 rounded-full" />
      {/* Circle at the left end */}
      <div
        className="absolute bg-blue-500 rounded-full"
        style={{
          width: 6,
          height: 6,
          top: -2,
          left: 0,
        }}
      />
    </div>
  );
}

/**
 * A highlight outline on a container indicating the node will be dropped inside.
 * Renders as a border overlay around the entire container.
 */
function ContainerHighlight({ depth }: { depth: number }) {
  const leftOffset = depth * INDENT_PX;

  return (
    <div
      className="absolute pointer-events-none z-40 border-2 border-blue-500 border-dashed rounded-md bg-blue-500/10"
      style={{
        left: leftOffset,
        right: 0,
        top: 0,
        bottom: 0,
      }}
    />
  );
}
