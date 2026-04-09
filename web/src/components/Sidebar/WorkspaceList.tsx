import { useWorkspaces } from '../../api/hooks';

interface WorkspaceListProps {
  selectedMode: string | null;
  selectedWorkspace: string | null;
  onSelectWorkspace: (workspace: string) => void;
}

export function WorkspaceList({
  selectedMode,
  selectedWorkspace,
  onSelectWorkspace,
}: WorkspaceListProps) {
  const { data: workspaces, isLoading, error } = useWorkspaces(selectedMode);

  return (
    <div className="mb-4">
      <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
        Workspaces
      </h3>

      {isLoading && (
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-8 bg-gray-800 rounded animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-400">Failed to load workspaces</p>
      )}

      {!isLoading && !error && (!workspaces || workspaces.length === 0) && selectedMode && (
        <p className="text-xs text-gray-500">No workspaces in this mode</p>
      )}

      {!isLoading && !error && workspaces && (
        <ul className="space-y-0.5">
          {workspaces.map((ws) => (
            <li key={ws.name}>
              <button
                type="button"
                onClick={() => onSelectWorkspace(ws.name)}
                className={`w-full text-left px-3 py-1.5 rounded text-sm flex items-center gap-2 transition-colors ${
                  selectedWorkspace === ws.name
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'hover:bg-gray-800 text-gray-300'
                }`}
              >
                {/* Active/inactive indicator */}
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    ws.active ? 'bg-green-400' : 'bg-gray-600'
                  }`}
                  title={ws.active ? 'Active' : 'Inactive'}
                />

                <span className="truncate flex-1">{ws.name}</span>

                {/* Inherited/overridden badges */}
                {ws.inherited && !ws.overridden && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 flex-shrink-0"
                    title="Inherited from base mode"
                  >
                    inherited
                  </span>
                )}
                {ws.overridden && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/40 text-amber-400 flex-shrink-0"
                    title="Overridden in this mode"
                  >
                    override
                  </span>
                )}

                {/* Project indicator */}
                {ws.project && (
                  <span
                    className="text-[10px] text-gray-500 flex-shrink-0"
                    title={`Project: ${ws.project}`}
                  >
                    {ws.project}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
