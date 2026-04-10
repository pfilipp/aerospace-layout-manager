import { useDraggable } from '@dnd-kit/core';
import { useApps, useDiscoverApps } from '../../api/hooks';
import { addToast } from '../Toast';
import type { AppEntry } from '../../types';

interface AppRegistryProps {
  onSelectApp: (bundleId: string, app: AppEntry) => void;
}

export function AppRegistry({ onSelectApp }: AppRegistryProps) {
  const { data: apps, isLoading, error } = useApps();
  const discoverMutation = useDiscoverApps();

  const handleDiscover = () => {
    discoverMutation.mutate(undefined, {
      onError: (err) => {
        if (err.message.includes('503')) {
          addToast('error', 'AeroSpace is not running. Start it to discover apps.');
        } else {
          addToast('error', `Discovery failed: ${err.message}`);
        }
      },
      onSuccess: () => {
        addToast('success', 'App discovery complete.');
      },
    });
  };

  const appEntries = apps
    ? Object.entries(apps).sort(([, a], [, b]) => a.name.localeCompare(b.name))
    : [];

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Apps
        </h3>
        <button
          type="button"
          onClick={handleDiscover}
          disabled={discoverMutation.isPending}
          className="text-xs text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
        >
          {discoverMutation.isPending ? 'Discovering...' : 'Discover'}
        </button>
      </div>

      {error && (
        <p className="text-xs text-red-400 mb-2">Failed to load apps</p>
      )}

      {isLoading && (
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-7 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && appEntries.length === 0 && (
        <p className="text-xs text-gray-500">No apps in registry</p>
      )}

      {!isLoading && (
        <ul className="space-y-0.5 max-h-48 overflow-y-auto">
          {appEntries.map(([bundleId, app]) => (
            <DraggableAppItem
              key={bundleId}
              bundleId={bundleId}
              app={app}
              onSelectApp={onSelectApp}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function DraggableAppItem({
  bundleId,
  app,
  onSelectApp,
}: {
  bundleId: string;
  app: AppEntry;
  onSelectApp: (bundleId: string, app: AppEntry) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `app-entry:${bundleId}`,
    data: { bundleId, app },
  });

  return (
    <li ref={setNodeRef} {...listeners} {...attributes}>
      <button
        type="button"
        onClick={() => onSelectApp(bundleId, app)}
        className={`w-full text-left px-3 py-1 rounded text-sm text-gray-300 hover:bg-gray-800 flex items-center gap-2 transition-colors ${
          isDragging ? 'opacity-50' : ''
        }`}
        title={bundleId}
      >
        <span className="truncate flex-1">{app.name}</span>
        <span
          className={`text-[10px] px-1 py-0.5 rounded flex-shrink-0 ${
            app.source === 'seed'
              ? 'bg-gray-700 text-gray-400'
              : 'bg-blue-900/30 text-blue-400'
          }`}
        >
          {app.source}
        </span>
      </button>
    </li>
  );
}
