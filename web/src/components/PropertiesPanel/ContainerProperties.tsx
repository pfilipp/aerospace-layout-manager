import type { ContainerNode, LayoutType, Orientation, TreeNode } from '../../../server/types';

interface ContainerPropertiesProps {
  node: ContainerNode;
  onUpdate: (updatedNode: TreeNode) => void;
}

const LAYOUT_OPTIONS: { value: LayoutType; label: string }[] = [
  { value: 'h_accordion', label: 'Horizontal Accordion' },
  { value: 'v_accordion', label: 'Vertical Accordion' },
  { value: 'h_tiles', label: 'Horizontal Tiles' },
  { value: 'v_tiles', label: 'Vertical Tiles' },
];

const ORIENTATION_OPTIONS: { value: Orientation; label: string }[] = [
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
];

export function ContainerProperties({ node, onUpdate }: ContainerPropertiesProps) {
  const handleLayoutChange = (layout: LayoutType) => {
    onUpdate({ ...node, layout });
  };

  const handleOrientationChange = (orientation: Orientation) => {
    onUpdate({ ...node, orientation });
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
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-gray-400">
          Orientation
        </label>
        <div className="flex gap-2">
          {ORIENTATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleOrientationChange(opt.value)}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                node.orientation === opt.value
                  ? 'border-blue-500 bg-blue-500/20 text-blue-400'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pt-2 text-xs text-gray-500">
        {node.children.length} {node.children.length === 1 ? 'child' : 'children'}
      </div>
    </div>
  );
}
