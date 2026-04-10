import { useState, useCallback } from 'react';
import type { AppEntry, ContainerNode, WindowNode } from '../../types';
import { AppSearchDropdown } from './AppSearchDropdown';
import { useEditorStore, findNodeById, getNodeId } from '../../store';
import { getDefaultChildLayout } from '../../utils/normalization';

interface TreeActionsProps {
  /** Store _nodeId of the currently selected node (resolved from flat ID) */
  selectedStoreNodeId: string | null;
  /** Whether the selected node is a container */
  selectedIsContainer: boolean;
  /** Store _nodeIds of multi-selected nodes (resolved from flat IDs) */
  multiSelectedStoreIds: Set<string>;
  /** Callback to clear multi-selection after wrap */
  onClearMultiSelect: () => void;
}

/**
 * Toolbar with tree manipulation actions: "+ Add app", "+ Container", "Wrap in Container".
 * Sits below the tree editor header.
 *
 * All node IDs passed to this component should be store _nodeIds (not flat path IDs),
 * since the store actions (addNode, wrapNodes) operate on _nodeId values.
 */
export function TreeActions({
  selectedStoreNodeId,
  selectedIsContainer,
  multiSelectedStoreIds,
  onClearMultiSelect,
}: TreeActionsProps) {
  const [showAppDropdown, setShowAppDropdown] = useState(false);

  const tree = useEditorStore((s) => s.tree);
  const addNode = useEditorStore((s) => s.addNode);
  const wrapNodes = useEditorStore((s) => s.wrapNodes);

  // Determine the target container for adding nodes.
  // If a container is selected, add to it. Otherwise add to root.
  const getTargetContainerId = useCallback((): string | null => {
    if (!tree) return null;
    if (selectedStoreNodeId && selectedIsContainer) {
      return selectedStoreNodeId;
    }
    // Fall back to root container's _nodeId
    return getNodeId(tree) ?? null;
  }, [tree, selectedStoreNodeId, selectedIsContainer]);

  const handleAddApp = useCallback(
    (bundleId: string, app: AppEntry) => {
      const parentId = getTargetContainerId();
      if (!parentId) return;

      const windowNode: WindowNode = {
        type: 'window',
        'app-bundle-id': bundleId,
        'app-name': app.name,
        startup: app.defaultStartup || '',
        title: '',
        'window-id': 0, // Will be renumbered on generation
      };

      addNode(parentId, windowNode);
      setShowAppDropdown(false);
    },
    [getTargetContainerId, addNode],
  );

  const handleAddContainer = useCallback(() => {
    const parentId = getTargetContainerId();
    if (!parentId || !tree) return;

    // Find the parent container to determine the correct child layout
    const parentNode = findNodeById(tree, parentId);
    const parentLayout = parentNode && parentNode.type === 'container' ? parentNode.layout : 'h_tiles';

    // Auto-set opposite orientation to satisfy AeroSpace normalization
    const childLayout = getDefaultChildLayout(parentLayout);

    const containerNode: ContainerNode = {
      type: 'container',
      layout: childLayout,
      orientation: childLayout.startsWith('h_') ? 'horizontal' : 'vertical',
      children: [],
    };

    addNode(parentId, containerNode);
  }, [getTargetContainerId, addNode, tree]);

  const handleWrap = useCallback(() => {
    if (multiSelectedStoreIds.size === 0) return;
    // The store's wrapNodes will auto-enforce opposite orientation,
    // but we pass a reasonable default so flipping is minimal
    wrapNodes(Array.from(multiSelectedStoreIds), 'h_tiles');
    onClearMultiSelect();
  }, [multiSelectedStoreIds, wrapNodes, onClearMultiSelect]);

  const hasTree = tree !== null;
  const canWrap = multiSelectedStoreIds.size >= 1;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-800 bg-gray-900/50">
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowAppDropdown(!showAppDropdown)}
          disabled={!hasTree}
          className="px-2.5 py-1 text-xs rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          + Add app
        </button>
        {showAppDropdown && (
          <AppSearchDropdown
            onSelect={handleAddApp}
            onClose={() => setShowAppDropdown(false)}
          />
        )}
      </div>

      <button
        type="button"
        onClick={handleAddContainer}
        disabled={!hasTree}
        className="px-2.5 py-1 text-xs rounded border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:border-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        + Container
      </button>

      {canWrap && (
        <button
          type="button"
          onClick={handleWrap}
          className="px-2.5 py-1 text-xs rounded border border-blue-700 bg-blue-900/40 text-blue-300 hover:bg-blue-800/40 transition-colors"
        >
          Wrap in Container ({multiSelectedStoreIds.size})
        </button>
      )}

      {multiSelectedStoreIds.size > 0 && (
        <span className="text-[10px] text-gray-500 ml-auto">
          {multiSelectedStoreIds.size} selected
        </span>
      )}
    </div>
  );
}

