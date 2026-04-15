import { useState, useMemo } from 'react';
import type { WindowNode, TreeNode, AppEntry } from '../../../server/types';

/**
 * Per-app configuration for the "path shortcut" field in window properties.
 * Each entry knows how to serialize a user-entered path into a startup command
 * and how to parse an existing command back out — as long as it was produced
 * by this shortcut. Commands that don't match `parse` (e.g. still hold a
 * `${PROJECT_*}` template or were manually edited) fall through to the raw
 * "Advanced" textarea and trigger a warning hint.
 */
interface PathShortcut {
  /** Short hint rendered next to the label (e.g. "iTerm", "VS Code"). */
  appLabel: string;
  /** Field label and accessible name. */
  label: string;
  /** Example shown as placeholder in the input. */
  placeholder: string;
  /** Serialize a user-entered path into a startup command. Empty path → empty command. */
  build: (value: string) => string;
  /** Parse a startup command back into a path, or null if the command isn't one we generated. */
  parse: (startup: string) => string | null;
}

const ITERM_SCRIPT = '~/nix-config/modules/darwin/scripts/iterm-window.sh';

const PATH_SHORTCUTS: Record<string, PathShortcut> = {
  'com.googlecode.iterm2': {
    appLabel: 'iTerm',
    label: 'Working Directory',
    placeholder: '~/Projects/my-project',
    build: (value) => {
      const trimmed = value.trim();
      return trimmed ? `${ITERM_SCRIPT} 'cd ${trimmed}'` : '';
    },
    parse: (startup) => {
      const re = /^~\/nix-config\/modules\/darwin\/scripts\/iterm-window\.sh\s+'cd\s+(.+?)'\s*$/;
      const match = startup.match(re);
      return match ? match[1] : null;
    },
  },
  'com.microsoft.VSCode': {
    appLabel: 'VS Code',
    label: 'Working Directory',
    placeholder: '~/Projects/my-project',
    build: (value) => {
      const trimmed = value.trim();
      return trimmed ? `code ${trimmed}` : '';
    },
    parse: (startup) => {
      const match = startup.trim().match(/^code\s+(\S.*?)\s*$/);
      if (!match) return null;
      // Reject unresolved templates (e.g. "code ${PROJECT_DIR}")
      if (match[1].includes('${')) return null;
      return match[1];
    },
  },
  'com.apple.dt.Xcode': {
    appLabel: 'Xcode',
    label: 'Xcode Project',
    placeholder: '~/Projects/my-project/MyApp.xcodeproj',
    build: (value) => {
      const trimmed = value.trim();
      return trimmed ? `open ${trimmed}` : '';
    },
    parse: (startup) => {
      const match = startup.trim().match(/^open\s+(\S.*?)\s*$/);
      if (!match) return null;
      if (match[1].includes('${')) return null;
      return match[1];
    },
  },
};

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

  const shortcut = PATH_SHORTCUTS[node['app-bundle-id']];

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

      {shortcut ? (
        <>
          <PathShortcutField
            shortcut={shortcut}
            startup={node.startup}
            onChange={(next) => handleFieldChange('startup', next)}
          />
          <details className="group space-y-1.5">
            <summary className="cursor-pointer text-sm font-medium text-gray-400 hover:text-gray-200 select-none">
              Advanced: raw startup command
            </summary>
            <div className="mt-1.5 space-y-1.5">
              <label htmlFor="startup" className="sr-only">
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
          </details>
        </>
      ) : (
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
      )}

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

/**
 * Generic path shortcut field. Renders a single input whose value round-trips
 * through `shortcut.parse` / `shortcut.build`. If the current startup command
 * doesn't match the shortcut pattern, the input shows empty and a hint warns
 * that typing will overwrite the existing command (useful when the startup
 * still holds an unresolved `${PROJECT_*}` template from the app registry).
 */
function PathShortcutField({
  shortcut,
  startup,
  onChange,
}: {
  shortcut: PathShortcut;
  startup: string;
  onChange: (next: string) => void;
}) {
  const parsed = shortcut.parse(startup);
  const customCommand = startup.trim().length > 0 && parsed === null;

  return (
    <div className="space-y-1.5">
      <label htmlFor="shortcut-path" className="block text-sm font-medium text-gray-400">
        {shortcut.label}
        <span className="ml-2 text-[10px] font-normal text-gray-500">
          {shortcut.appLabel}
        </span>
      </label>
      <input
        id="shortcut-path"
        type="text"
        value={parsed ?? ''}
        placeholder={shortcut.placeholder}
        onChange={(e) => onChange(shortcut.build(e.target.value))}
        className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
      {customCommand && (
        <p className="text-[11px] text-amber-400">
          Current startup uses a custom command (e.g. a project template).
          Editing the field above will replace it.
        </p>
      )}
    </div>
  );
}
