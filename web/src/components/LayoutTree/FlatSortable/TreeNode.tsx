import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { FlatNode } from '../types';
import type { ContainerNode, WindowNode } from '../../../types';

const INDENT_PX = 24;

interface TreeNodeProps {
  flatNode: FlatNode;
  onToggleCollapse: (id: string) => void;
  onSelectNode: (id: string) => void;
  isSelected: boolean;
}

/**
 * Original flat tree node renderer (T10a).
 * Still exported for backward compatibility, but the TreeEditor
 * now uses RecursiveContainer + SortableNodeWrapper instead.
 */
export function TreeNodeItem({
  flatNode,
  onToggleCollapse,
  onSelectNode,
  isSelected,
}: TreeNodeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: flatNode.id });

  const style: React.CSSProperties = {
    paddingLeft: flatNode.depth * INDENT_PX + 8,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isContainer = flatNode.node.type === 'container';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 py-1.5 px-2 rounded cursor-pointer select-none border border-transparent ${
        isSelected
          ? 'bg-blue-900/40 border-blue-700'
          : 'hover:bg-gray-800/50'
      } ${isDragging ? 'z-50' : ''}`}
      onClick={() => onSelectNode(flatNode.id)}
      {...attributes}
      {...listeners}
    >
      {isContainer ? (
        <ContainerLabel
          node={flatNode.node as ContainerNode}
          isCollapsed={flatNode.isCollapsed}
          onToggle={() => onToggleCollapse(flatNode.id)}
        />
      ) : (
        <WindowLabel node={flatNode.node as WindowNode} />
      )}
    </div>
  );
}

/**
 * A thin sortable wrapper that applies dnd-kit's useSortable to any children.
 * Used by RecursiveContainer to keep recursive rendering separate from DnD plumbing.
 *
 * The wrapper provides the drag handle (ref, listeners, attributes) and applies
 * transform/transition/opacity styles while the RecursiveContainer controls
 * the visual content (container headers, window rows, nesting lines).
 */
interface SortableNodeWrapperProps {
  flatNode: FlatNode;
  children: ReactNode;
}

export function SortableNodeWrapper({ flatNode, children }: SortableNodeWrapperProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: flatNode.id });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={isDragging ? 'z-50 relative' : 'relative'}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

function ContainerLabel({
  node,
  isCollapsed,
  onToggle,
}: {
  node: ContainerNode;
  isCollapsed: boolean;
  onToggle: () => void;
}) {
  const childCount = node.children.length;

  return (
    <>
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
      <span className="text-sm text-gray-200 font-medium">
        {node.layout}
      </span>
      <span className="text-xs text-gray-500">
        / {node.orientation}
      </span>
      <span className="text-xs text-gray-600 ml-auto">
        {childCount} {childCount === 1 ? 'child' : 'children'}
      </span>
    </>
  );
}

function WindowLabel({ node }: { node: WindowNode }) {
  return (
    <>
      <span className="w-4 flex-shrink-0" />
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
      <span className="text-sm text-gray-200">
        {node['app-name'] || node['app-bundle-id']}
      </span>
      {node.title && (
        <span className="text-xs text-gray-500 truncate">
          — {node.title}
        </span>
      )}
    </>
  );
}
