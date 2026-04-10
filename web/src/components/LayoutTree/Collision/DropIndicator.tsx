/**
 * Visual drop indicators for the drag-and-drop tree editor.
 *
 * Three indicator types:
 * 1. BetweenIndicator: a horizontal blue line with circle endpoint showing where
 *    a node will be inserted between siblings (renders for 'before'/'after' drop targets).
 * 2. ContainerBodyHighlight: a dashed blue border + translucent blue background
 *    on the full container body when a node will be dropped inside it.
 * 3. InsertionLine: a thin line between children at the resolved index when
 *    an 'inside' drop target has a specific insertIndex.
 *
 * All indicators use absolute positioning within relative containers so they
 * do not shift layout.
 *
 * Drop target is read from DropTargetContext (not passed as a prop).
 */

import { useDropTarget } from './DropTargetContext';
import { useDndState } from '../../DndProvider';

const INDENT_PX = 24;

interface NodeDropIndicatorProps {
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
 * Place this component inside each tree node's wrapper (which must have position: relative).
 *
 * Reads the current drop target from DropTargetContext reactively.
 *
 * It renders when:
 * 1. The dropTarget matches this node's ID directly (before/after)
 * 2. This node is a child of the targeted container at the insertion index (inside-with-position)
 */
export function DropIndicator({
  nodeId,
  depth,
  isContainer: _isContainer,
  parentId,
  indexInParent,
}: NodeDropIndicatorProps) {
  const dropTarget = useDropTarget();

  if (!dropTarget) return null;

  // Direct target match for before/after
  if (dropTarget.targetId === nodeId) {
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
 * Renders a highlight on the container body when drop target is "inside" this container.
 * Place this component inside the ContainerBodyDroppable wrapper.
 *
 * Shows:
 * - Dashed blue border + translucent blue background on the full body area
 * - Optionally, a thin insertion line between children at the resolved index
 *   (handled by DropIndicator on individual children)
 */
export function ContainerBodyHighlight({
  flatNodeId,
  depth,
}: {
  flatNodeId: string;
  depth: number;
}) {
  const dropTarget = useDropTarget();
  const { activeDragId } = useDndState();
  const isDragging = activeDragId != null;

  if (!isDragging) return null;

  // Active when dropping "inside" this container, OR when the drop target
  // is before/after a direct child of this container (the user is clearly
  // interacting within this container's body area).
  const isActiveTarget =
    dropTarget != null && (
      (dropTarget.type === 'inside' && dropTarget.targetId === flatNodeId) ||
      (dropTarget.targetId.startsWith(flatNodeId + '/') &&
        // Direct child only — no deeper descendants
        !dropTarget.targetId.slice(flatNodeId.length + 1).includes('/'))
    );

  if (isActiveTarget) {
    // Actively hovered — strong highlight
    return (
      <div
        className="absolute top-0 right-0 bottom-0 pointer-events-none z-30 border-2 border-blue-500 border-dashed rounded-md bg-blue-500/10"
      style={{ left: (depth + 1) * INDENT_PX }}
      />
    );
  }

  // Not hovered but drag is active — subtle "available" indicator
  return (
    <div
      className="absolute top-0 right-0 bottom-0 pointer-events-none z-20 border border-gray-600 border-dashed rounded-md"
      style={{ left: (depth + 1) * INDENT_PX }}
    />
  );
}

/**
 * A horizontal line indicator showing insertion point between siblings.
 * Renders at the top or bottom edge of the node.
 * Uses absolute positioning so it does not shift layout.
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
