import type { ContainerNode, LayoutType, TreeNode } from '../../../server/types';
import {
  getOrientation,
  getAllowedChildLayouts,
  findChildViolations,
} from '../../utils/normalization';

interface ContainerPropertiesProps {
  node: ContainerNode;
  /** The parent container's layout type, or null if this is the root container. */
  parentLayout: LayoutType | null;
  onUpdate: (updatedNode: TreeNode) => void;
}

const LAYOUT_OPTIONS: { value: LayoutType; label: string }[] = [
  { value: 'h_accordion', label: 'Horizontal Accordion' },
  { value: 'v_accordion', label: 'Vertical Accordion' },
  { value: 'h_tiles', label: 'Horizontal Tiles' },
  { value: 'v_tiles', label: 'Vertical Tiles' },
];

export function ContainerProperties({ node, parentLayout, onUpdate }: ContainerPropertiesProps) {
  // Determine which layout types are allowed based on parent orientation.
  // Root containers (parentLayout === null) have no restriction.
  const allowedLayouts = parentLayout ? getAllowedChildLayouts(parentLayout) : null;
  const isConstrained = allowedLayouts !== null;

  // Check if any children would be violated by the current layout
  const childViolationCount = findChildViolations(node.layout, node.children).length;

  const handleLayoutChange = (layout: LayoutType) => {
    // The store's updateNode will enforce normalization and auto-fix children
    const newOrientation = getOrientation(layout);
    onUpdate({ ...node, layout, orientation: newOrientation });
  };

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Container Properties
      </h3>

      <div className="space-y-1.5">
        <label htmlFor="layout-type" className="block text-sm font-medium text-gray-400">
          Layout Type
        </label>
        <select
          id="layout-type"
          value={node.layout}
          onChange={(e) => handleLayoutChange(e.target.value as LayoutType)}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {LAYOUT_OPTIONS.map((opt) => {
            const isDisallowed = isConstrained && !allowedLayouts.includes(opt.value);
            return (
              <option
                key={opt.value}
                value={opt.value}
                disabled={isDisallowed}
              >
                {opt.label}{isDisallowed ? ' (same orientation as parent)' : ''}
              </option>
            );
          })}
        </select>
        {isConstrained && (
          <p className="text-[11px] text-amber-500/80 mt-1 flex items-start gap-1.5">
            <span className="flex-shrink-0 mt-px">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 011 1v3.75a1 1 0 11-2 0V4.5a1 1 0 011-1zM8 11a1 1 0 100 2 1 1 0 000-2z" />
              </svg>
            </span>
            <span>
              AeroSpace requires nested containers to have opposite orientations.{' '}
              {getOrientation(parentLayout!) === 'horizontal' ? 'Vertical' : 'Horizontal'}{' '}
              layouts only.
            </span>
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-400">
          Orientation
        </label>
        <div className="flex gap-2">
          <div
            className="flex-1 rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm font-medium text-gray-300 text-center"
          >
            {node.orientation === 'horizontal' ? 'Horizontal' : 'Vertical'}
          </div>
        </div>
        <p className="text-[11px] text-gray-500">
          Orientation is derived from the layout type and cannot be set independently.
        </p>
      </div>

      <div className="pt-2 text-xs text-gray-500">
        {node.children.length} {node.children.length === 1 ? 'child' : 'children'}
        {childViolationCount > 0 && (
          <span className="text-amber-500 ml-2">
            ({childViolationCount} {childViolationCount === 1 ? 'child' : 'children'} will be auto-corrected on layout change)
          </span>
        )}
      </div>
    </div>
  );
}
