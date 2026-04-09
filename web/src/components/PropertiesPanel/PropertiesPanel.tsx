import type { TreeNode, AppEntry } from '../../../server/types';
import { ContainerProperties } from './ContainerProperties';
import { WindowProperties } from './WindowProperties';

interface PropertiesPanelProps {
  selectedNode: TreeNode | null;
  onUpdate: (updatedNode: TreeNode) => void;
  apps: Record<string, AppEntry>;
}

export function PropertiesPanel({ selectedNode, onUpdate, apps }: PropertiesPanelProps) {
  if (!selectedNode) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <p className="text-sm text-gray-500">Select a node to edit its properties</p>
      </div>
    );
  }

  return (
    <div className="p-4">
      {selectedNode.type === 'container' ? (
        <ContainerProperties node={selectedNode} onUpdate={onUpdate} />
      ) : (
        <WindowProperties node={selectedNode} onUpdate={onUpdate} apps={apps} />
      )}
    </div>
  );
}
