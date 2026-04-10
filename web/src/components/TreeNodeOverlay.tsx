/**
 * TreeNodeOverlay — presentational component rendered inside DragOverlay
 * when a tree node is being dragged. This is a visual ghost copy of the
 * dragged node's row. It does NOT use useSortable or any dnd-kit hooks
 * (rendering dnd-kit hooks inside DragOverlay causes ID collisions).
 */

import type { FlatNode } from './LayoutTree/types';
import type { ContainerNode, WindowNode } from '../types';

const INDENT_PX = 24;

/** Layout type badge color classes (mirrors RecursiveContainer) */
const LAYOUT_BADGE_COLORS: Record<string, string> = {
  h_accordion: 'bg-amber-900/60 text-amber-300',
  v_accordion: 'bg-purple-900/60 text-purple-300',
  h_tiles: 'bg-emerald-900/60 text-emerald-300',
  v_tiles: 'bg-sky-900/60 text-sky-300',
};

interface TreeNodeOverlayProps {
  flatNode: FlatNode;
}

/**
 * Renders a semi-transparent ghost copy of a tree node row.
 * Used as the DragOverlay content for tree node drags.
 */
export function TreeNodeOverlay({ flatNode }: TreeNodeOverlayProps) {
  const isContainer = flatNode.node.type === 'container';

  return (
    <div
      style={{ paddingLeft: flatNode.depth * INDENT_PX + 8 }}
      className="flex items-center gap-2 py-1.5 px-2 rounded cursor-grabbing select-none border border-blue-600 bg-gray-800 shadow-lg shadow-blue-900/30 opacity-90 min-w-48"
    >
      {isContainer ? (
        <ContainerOverlayContent node={flatNode.node as ContainerNode} />
      ) : (
        <WindowOverlayContent node={flatNode.node as WindowNode} />
      )}
    </div>
  );
}

function ContainerOverlayContent({ node }: { node: ContainerNode }) {
  const childCount = node.children.length;
  const badgeColor = LAYOUT_BADGE_COLORS[node.layout] || 'bg-gray-700 text-gray-300';

  return (
    <>
      {/* Placeholder for collapse toggle (not interactive in overlay) */}
      <span className="text-gray-500 w-4 text-center flex-shrink-0">
        {'\u25BC'}
      </span>

      {/* Container icon */}
      <span className="text-yellow-500 flex-shrink-0">
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
      <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${badgeColor}`}>
        {node.layout}
      </span>

      {/* Orientation indicator */}
      <span className="text-xs text-gray-500">
        {node.orientation === 'horizontal' ? '\u2194' : '\u2195'}
      </span>

      {/* Child count */}
      <span className="text-xs text-gray-600 ml-auto">
        {childCount} {childCount === 1 ? 'child' : 'children'}
      </span>
    </>
  );
}

function WindowOverlayContent({ node }: { node: WindowNode }) {
  return (
    <>
      {/* Spacer to align with container toggle */}
      <span className="w-4 flex-shrink-0" />

      {/* Window icon */}
      <span className="text-blue-400 flex-shrink-0">
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
    </>
  );
}
