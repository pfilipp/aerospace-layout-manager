import { useState, useMemo } from 'react';
import type { WindowNode, TreeNode, AppEntry } from '../../../server/types';

interface WindowPropertiesProps {
  node: WindowNode;
  onUpdate: (updatedNode: TreeNode) => void;
  apps: Record<string, AppEntry>;
}

export function WindowProperties({ node, onUpdate, apps }: WindowPropertiesProps) {
  const [bundleIdSearch, setBundleIdSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const filteredApps = useMemo(() => {
    if (!bundleIdSearch) return [];
    const query = bundleIdSearch.toLowerCase();
    return Object.entries(apps).filter(
      ([bundleId, app]) =>
        bundleId.toLowerCase().includes(query) ||
        app.name.toLowerCase().includes(query),
    );
  }, [bundleIdSearch, apps]);

  const handleFieldChange = (field: keyof WindowNode, value: string | number) => {
    onUpdate({ ...node, [field]: value });
  };

  const handleBundleIdSelect = (bundleId: string, appName: string) => {
    onUpdate({
      ...node,
      'app-bundle-id': bundleId,
      'app-name': appName,
    });
    setBundleIdSearch('');
    setShowDropdown(false);
  };

  return (
    <div className="space-y-5">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wider">
        Window Properties
      </h3>

      <div className="space-y-1.5">
        <label htmlFor="app-name" className="block text-sm font-medium text-gray-400">
          App Name
        </label>
        <input
          id="app-name"
          type="text"
          value={node['app-name']}
          onChange={(e) => handleFieldChange('app-name', e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="relative space-y-1.5">
        <label htmlFor="bundle-id" className="block text-sm font-medium text-gray-400">
          Bundle ID
        </label>
        <input
          id="bundle-id"
          type="text"
          value={node['app-bundle-id']}
          onChange={(e) => {
            handleFieldChange('app-bundle-id', e.target.value);
            setBundleIdSearch(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => {
            if (node['app-bundle-id']) {
              setBundleIdSearch(node['app-bundle-id']);
              setShowDropdown(true);
            }
          }}
          onBlur={() => {
            // Delay to allow click on dropdown item
            setTimeout(() => setShowDropdown(false), 200);
          }}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          autoComplete="off"
        />
        {showDropdown && filteredApps.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-md border border-gray-700 bg-gray-800 py-1 shadow-lg">
            {filteredApps.map(([bundleId, app]) => (
              <li key={bundleId}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleBundleIdSelect(bundleId, app.name);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-700"
                >
                  <span className="text-gray-100">{app.name}</span>
                  <span className="ml-2 text-xs text-gray-500">{bundleId}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="startup" className="block text-sm font-medium text-gray-400">
          Startup Command
        </label>
        <textarea
          id="startup"
          value={node.startup}
          onChange={(e) => handleFieldChange('startup', e.target.value)}
          rows={3}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="title" className="block text-sm font-medium text-gray-400">
          Title
        </label>
        <input
          id="title"
          type="text"
          value={node.title}
          onChange={(e) => handleFieldChange('title', e.target.value)}
          className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-gray-400">
          Window ID
        </span>
        <span className="block text-sm text-gray-500 tabular-nums">
          {node['window-id']}
        </span>
      </div>
    </div>
  );
}
