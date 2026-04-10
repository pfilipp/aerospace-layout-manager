import { useEffect, useRef } from 'react';
import type { ContainerNode, WindowNode } from '../../../types';
import type { FlatNode } from '../types';
import { DropIndicator } from '../Collision/DropIndicator';
import type { DropTarget } from '../Collision/types';
import { getNodeId } from '../../../store/editorStore';

const INDENT_PX = 24;

/** Layout type display names and color classes */
const LAYOUT_BADGE_COLORS: Record<string, string> = {
  h_accordion: 'bg-amber-900/60 text-amber-300',
  v_accordion: 'bg-purple-900/60 text-purple-300',
  h_tiles: 'bg-emerald-900/60 text-emerald-300',
  v_tiles: 'bg-sky-900/60 text-sky-300',
};

interface RecursiveContainerProps {
  /** The container node to render */
  container: ContainerNode;
  /** Current nesting depth (0 = root) */
  depth: number;
  /** The FlatNode ID for this container */
  flatNodeId: string;
  /** Set of collapsed container IDs */
  collapsedIds: Set<string>;
  /** Currently selected node ID */
  selectedNodeId: string | null;
  /** Callback when a node is clicked (receives mouse event for multi-select) */
  onSelectNode: (id: string, event: React.MouseEvent) => void;
  /** Callback to toggle collapse state */
  onToggleCollapse: (id: string) => void;
  /** Flat nodes list for resolving child IDs */
  flatNodes: FlatNode[];
  /** Render function for the sortable wrapper (provided by parent TreeEditor) */
  renderSortableWrapper: (
    flatNode: FlatNode,
    children: React.ReactNode,
  ) => React.ReactNode;
  /** Current drop target for rendering indicators */
  dropTarget: DropTarget | null;
  /** Set of multi-selected node IDs */
  multiSelectedIds?: Set<string>;
  /** Callback for right-click context menu */
  onContextMenu?: (id: string, event: React.MouseEvent) => void;
  /** FlatNode ID of the currently dragged node (null when not dragging) */
  activeDragId?: string | null;
  /** Callback when a drop zone is entered during native drag */
  onDropZoneEnter?: (containerId: string, insertIndex: number) => void;
}

/**
 * Recursively renders a container and all its children (windows and nested containers).
 * Each nesting level gets:
 * - Increased indentation with a left border connecting line
 * - A layout type badge on containers
 * - Visual distinction between containers and windows
 */
export function RecursiveContainer({
  container,
  depth,
  flatNodeId,
  collapsedIds,
  selectedNodeId,
  onSelectNode,
  onToggleCollapse,
  flatNodes,
  renderSortableWrapper,
  dropTarget,
  multiSelectedIds,
  onContextMenu,
  activeDragId,
  onDropZoneEnter,
}: RecursiveContainerProps) {
  const isCollapsed = collapsedIds.has(flatNodeId);
  const thisFlatNode = flatNodes.find((n) => n.id === flatNodeId);
  const isMultiSelected = multiSelectedIds?.has(flatNodeId) ?? false;
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging = activeDragId != null;

  // Auto-expand collapsed containers when a drag hovers over them
  const isDragTarget = dropTarget?.type === 'inside' && dropTarget?.targetId === flatNodeId;
  useEffect(() => {
    if (isDragTarget && isCollapsed) {
      expandTimerRef.current = setTimeout(() => {
        onToggleCollapse(flatNodeId);
      }, 500);
    }
    return () => {
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    };
  }, [isDragTarget, isCollapsed, flatNodeId, onToggleCollapse]);

  if (!thisFlatNode) return null;

  // Render the container header row (with sortable wrapper + drop indicator)
  const containerHeader = renderSortableWrapper(
    thisFlatNode,
    <div
      className="relative"
      data-node-id={flatNodeId}
      onContextMenu={(e) => onContextMenu?.(flatNodeId, e)}
    >
      <DropIndicator
        dropTarget={dropTarget}
        nodeId={flatNodeId}
        depth={depth}
        isContainer={true}
        parentId={thisFlatNode.parentId}
        indexInParent={thisFlatNode.index}
      />
      <ContainerHeader
        node={container}
        depth={depth}
        isCollapsed={isCollapsed}
        isSelected={selectedNodeId === (getNodeId(container) ?? flatNodeId)}
        isMultiSelected={isMultiSelected}
        onToggle={() => onToggleCollapse(flatNodeId)}
        onSelect={(e) => onSelectNode(getNodeId(container) ?? flatNodeId, e)}
      />
    </div>,
  );

  // If collapsed, render only the header
  if (isCollapsed) {
    return <>{containerHeader}</>;
  }

  // Check if this container is the active drop target
  const isDropTarget = dropTarget?.type === 'inside' && dropTarget?.targetId === flatNodeId;
  const dropInsertIndex = isDropTarget ? dropTarget?.insertIndex : undefined;

  // Render children recursively with connecting line and drop zones
  const childElements = container.children.map((child, index) => {
    const childId =
      child.type === 'container'
        ? `${flatNodeId}/c-${index}`
        : `${flatNodeId}/w-${index}`;

    const isLastChild = index === container.children.length - 1;

    if (child.type === 'container') {
      return (
        <div key={childId} className="relative">
          {/* Drop zone overlay at top edge */}
          {isDragging && (
            <DropZone
              containerId={flatNodeId}
              insertIndex={index}
              depth={depth + 1}
              isActive={dropInsertIndex === index}
              onDropZoneEnter={onDropZoneEnter}
              position="top"
            />
          )}
          <NestingLine depth={depth + 1} isLast={isLastChild} />
          <RecursiveContainer
            container={child}
            depth={depth + 1}
            flatNodeId={childId}
            collapsedIds={collapsedIds}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onToggleCollapse={onToggleCollapse}
            flatNodes={flatNodes}
            renderSortableWrapper={renderSortableWrapper}
            dropTarget={dropTarget}
            multiSelectedIds={multiSelectedIds}
            onContextMenu={onContextMenu}
            activeDragId={activeDragId}
            onDropZoneEnter={onDropZoneEnter}
          />
          {/* Drop zone after last child */}
          {isDragging && isLastChild && (
            <DropZone
              containerId={flatNodeId}
              insertIndex={index + 1}
              depth={depth + 1}
              isActive={dropInsertIndex === index + 1}
              onDropZoneEnter={onDropZoneEnter}
              position="bottom"
            />
          )}
        </div>
      );
    }

    // Window node
    const childFlatNode = flatNodes.find((n) => n.id === childId);
    if (!childFlatNode) return null;

    const isChildMultiSelected = multiSelectedIds?.has(childId) ?? false;

    return (
      <div key={childId} className="relative">
        {/* Drop zone overlay at top edge */}
        {isDragging && (
          <DropZone
            containerId={flatNodeId}
            insertIndex={index}
            depth={depth + 1}
            isActive={dropInsertIndex === index}
            onDropZoneEnter={onDropZoneEnter}
            position="top"
          />
        )}
        <NestingLine depth={depth + 1} isLast={isLastChild} />
        {renderSortableWrapper(
          childFlatNode,
          <div
            className="relative"
            data-node-id={childId}
            onContextMenu={(e) => onContextMenu?.(childId, e)}
          >
            <DropIndicator
              dropTarget={dropTarget}
              nodeId={childId}
              depth={depth + 1}
              isContainer={false}
              parentId={flatNodeId}
              indexInParent={index}
            />
            <WindowRow
              node={child}
              depth={depth + 1}
              isSelected={selectedNodeId === (getNodeId(child) ?? childId)}
              isMultiSelected={isChildMultiSelected}
              onSelect={(e) => onSelectNode(getNodeId(child) ?? childId, e)}
            />
          </div>,
        )}
        {/* Drop zone after last child */}
        {isDragging && isLastChild && (
          <DropZone
            containerId={flatNodeId}
            insertIndex={index + 1}
            depth={depth + 1}
            isActive={dropInsertIndex === index + 1}
            onDropZoneEnter={onDropZoneEnter}
            position="bottom"
          />
        )}
      </div>
    );
  });

  return (
    <>
      {containerHeader}
      <div className="relative">
        {/* Vertical connecting line running alongside children */}
        {container.children.length > 0 && (
          <div
            className="absolute border-l-2 border-gray-700"
            style={{
              left: (depth + 1) * INDENT_PX + 4,
              top: 0,
              bottom: 0,
            }}
          />
        )}
        {childElements}
      </div>
    </>
  );
}

// --- Sub-components ---

interface ContainerHeaderProps {
  node: ContainerNode;
  depth: number;
  isCollapsed: boolean;
  isSelected: boolean;
  isMultiSelected: boolean;
  onToggle: () => void;
  onSelect: (e: React.MouseEvent) => void;
}

function ContainerHeader({
  node,
  depth,
  isCollapsed,
  isSelected,
  isMultiSelected,
  onToggle,
  onSelect,
}: ContainerHeaderProps) {
  const childCount = node.children.length;
  const badgeColor = LAYOUT_BADGE_COLORS[node.layout] || 'bg-gray-700 text-gray-300';

  const selectionClass = isSelected
    ? 'bg-blue-900/40 border-blue-700'
    : isMultiSelected
      ? 'bg-blue-900/20 border-blue-800'
      : 'hover:bg-gray-800/50';

  return (
    <div
      style={{ paddingLeft: depth * INDENT_PX + 8 }}
      className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer select-none border border-transparent ${selectionClass}`}
      onClick={onSelect}
    >
      {/* Collapse toggle */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="text-gray-400 hover:text-gray-200 w-4 text-center flex-shrink-0"
        aria-label={isCollapsed ? 'Expand' : 'Collapse'}
      >
        {isCollapsed ? '\u25B6' : '\u25BC'}
      </button>

      {/* Container icon */}
      <span className="text-yellow-500 flex-shrink-0" title="Container">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="inline-block"
        >
          <path d="M1 3.5A1.5 1.5 0 012.5 2h3.879a1.5 1.5 0 011.06.44l1.122 1.12A1.5 1.5 0 009.621 4H13.5A1.5 1.5 0 0115 5.5v7a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 12.5v-9z" />
        </svg>
      </span>

      {/* Layout type badge */}
      <span
        className={`text-xs font-mono px-1.5 py-0.5 rounded ${badgeColor}`}
      >
        {node.layout}
      </span>

      {/* Orientation indicator */}
      <span className="text-xs text-gray-500">
        {node.orientation === 'horizontal' ? '\u2194' : '\u2195'}
      </span>

      {/* Normalization constraint indicator for nested containers */}
      {depth > 0 && (
        <span
          className="text-[10px] text-amber-600"
          title="Orientation is constrained by AeroSpace normalization: nested containers must have opposite orientations from their parent."
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="inline-block">
            <path d="M8 1a4 4 0 00-4 4v3H3a1 1 0 00-1 1v5a1 1 0 001 1h10a1 1 0 001-1V9a1 1 0 00-1-1h-1V5a4 4 0 00-4-4zm2 7H6V5a2 2 0 114 0v3z" />
          </svg>
        </span>
      )}

      {/* Multi-select indicator */}
      {isMultiSelected && (
        <span className="text-[10px] text-blue-400">selected</span>
      )}

      {/* Child count */}
      <span className="text-xs text-gray-600 ml-auto">
        {childCount} {childCount === 1 ? 'child' : 'children'}
      </span>
    </div>
  );
}

interface WindowRowProps {
  node: WindowNode;
  depth: number;
  isSelected: boolean;
  isMultiSelected: boolean;
  onSelect: (e: React.MouseEvent) => void;
}

function WindowRow({ node, depth, isSelected, isMultiSelected, onSelect }: WindowRowProps) {
  const selectionClass = isSelected
    ? 'bg-blue-900/40 border-blue-700'
    : isMultiSelected
      ? 'bg-blue-900/20 border-blue-800'
      : 'hover:bg-gray-800/50';

  return (
    <div
      style={{ paddingLeft: depth * INDENT_PX + 8 }}
      className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer select-none border border-transparent ${selectionClass}`}
      onClick={onSelect}
    >
      {/* Spacer to align with container toggle button */}
      <span className="w-4 flex-shrink-0" />

      {/* Window icon */}
      <span className="text-blue-400 flex-shrink-0" title="Window">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="inline-block"
        >
          <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3zm1 2v8h10V5H3z" />
        </svg>
      </span>

      {/* App name */}
      <span className="text-sm text-gray-200">
        {node['app-name'] || node['app-bundle-id']}
      </span>

      {/* Title */}
      {node.title && (
        <span className="text-xs text-gray-500 truncate">
          — {node.title}
        </span>
      )}

      {/* Multi-select indicator */}
      {isMultiSelected && (
        <span className="text-[10px] text-blue-400 ml-auto">selected</span>
      )}
    </div>
  );
}

/**
 * Visible drop zone rendered between children during drag.
 * Uses absolute positioning so it doesn't shift the layout.
 * Sits as a thin overlay at the top edge of its sibling element.
 */
function DropZone({
  containerId,
  insertIndex,
  depth,
  isActive,
  onDropZoneEnter,
  position,
}: {
  containerId: string;
  insertIndex: number;
  depth: number;
  isActive: boolean;
  onDropZoneEnter?: (containerId: string, insertIndex: number) => void;
  /** 'top' for before-child zones, 'bottom' for the zone after the last child */
  position: 'top' | 'bottom';
}) {
  return (
    <div
      data-drop-zone={`${containerId}:${insertIndex}`}
      data-node-id={containerId}
      className="absolute left-0 right-0 z-30"
      style={{
        [position]: -6,
        height: 12,
        paddingLeft: depth * INDENT_PX + 20,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDropZoneEnter?.(containerId, insertIndex);
      }}
    >
      <div
        className={`
          h-full rounded transition-colors duration-100
          ${isActive
            ? 'bg-blue-500/30 border border-dashed border-blue-400'
            : 'border border-dashed border-transparent hover:border-blue-500/40 hover:bg-blue-500/10'
          }
        `}
      >
        <div className={`h-0.5 mt-[5px] rounded-full mx-1 ${isActive ? 'bg-blue-400' : 'bg-transparent'}`} />
      </div>
    </div>
  );
}

/**
 * Renders a horizontal branch line connecting a child to its parent's vertical line.
 */
function NestingLine({ depth, isLast: _isLast }: { depth: number; isLast: boolean }) {
  return (
    <div
      className="absolute border-t-2 border-gray-700"
      style={{
        left: depth * INDENT_PX + 4,
        top: 16, // vertically centered on the row
        width: 12,
      }}
    />
  );
}
