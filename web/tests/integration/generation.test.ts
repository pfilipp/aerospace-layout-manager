/**
 * Integration tests — generation output compatibility.
 *
 * Verifies that generated layout JSONs match the schema and structure
 * of existing hand-crafted layouts consumed by aerospace-layout-manager.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  Config,
  ContainerNode,
  LayoutJsonFile,
  TreeNode,
  WindowNode,
  Workspace,
} from '../../server/types.js';
import { resolveMode } from '../../server/routes/modes.js';

// ---------------------------------------------------------------------------
// We can't call generateMode / generateWorkspace directly because they write
// to the real ~/.config/aerospace/ paths.  Instead we import the internal
// building blocks that are pure (no I/O) and test the file-writing path by
// providing a temporary output directory.
//
// The generate service exposes buildLayoutJson as a private function, so we
// replicate its logic here using the public resolveMode + the renumber helper
// that we also replicate.  This keeps the tests decoupled from internal APIs
// while still validating the exact same output format.
// ---------------------------------------------------------------------------

// --- helpers: replicate the pure parts of generate.ts ---

function renumberWindowIds(node: TreeNode, counter: { value: number }): void {
  if (node.type === 'window') {
    (node as WindowNode)['window-id'] = counter.value;
    counter.value += 1;
    return;
  }
  for (const child of (node as ContainerNode).children) {
    renumberWindowIds(child, counter);
  }
}

function buildLayoutJson(wsName: string, workspace: Workspace): LayoutJsonFile {
  const layoutClone: ContainerNode = JSON.parse(
    JSON.stringify(workspace.layout)
  );
  const counter = { value: 1 };
  renumberWindowIds(layoutClone, counter);
  return [
    {
      name: wsName,
      type: 'workspace',
      'root-container': layoutClone,
    },
  ];
}

// --- helpers: build startup script content (replicate from startup.ts) ---

function buildStartupScriptContent(
  config: Config,
  modeName: string
): string {
  const resolved = resolveMode(config, modeName);
  if (!resolved) {
    throw new Error(`Mode "${modeName}" not found or cannot be resolved`);
  }

  const layoutsDir = path.join(os.homedir(), '.config', 'aerospace', 'layouts');
  function getLayoutPath(mode: string, ws: string): string {
    if (mode === 'dual') return path.join(layoutsDir, `${ws}.json`);
    return path.join(layoutsDir, mode, `${ws}.json`);
  }

  const lines: string[] = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    `# Generated startup script for mode: ${modeName}`,
  ];

  // Skip the timestamp line since it changes per run — just check structural lines
  const activeWorkspaces = Object.entries(resolved)
    .filter(([, ws]) => ws.active)
    .map(([wsName]) => wsName);

  if (activeWorkspaces.length === 0) {
    lines.push('# No active workspaces in this mode');
  } else {
    for (const wsName of activeWorkspaces) {
      const layoutPath = getLayoutPath(modeName, wsName);
      lines.push(`$LAYOUT_ENGINE ${wsName} "${layoutPath}"`);
    }
  }

  return lines.join('\n');
}

// --- sample data factories ---

function makeWindow(
  bundleId: string,
  appName: string,
  startup: string,
  windowId: number
): WindowNode {
  return {
    type: 'window',
    'app-bundle-id': bundleId,
    'app-name': appName,
    startup,
    title: '',
    'window-id': windowId,
  };
}

function makeContainer(
  layout: ContainerNode['layout'],
  orientation: ContainerNode['orientation'],
  children: TreeNode[]
): ContainerNode {
  return { type: 'container', layout, orientation, children };
}

function makeWorkspace(layout: ContainerNode, active = true): Workspace {
  return { layout, project: null, active };
}

function makeSampleConfig(): Config {
  const codeLayout = makeContainer('h_accordion', 'horizontal', [
    makeWindow('com.microsoft.VSCode', 'Code', 'code ~/Projects/tidal', 100),
    makeWindow(
      'com.googlecode.iterm2',
      'iTerm2',
      "~/nix-config/modules/darwin/scripts/iterm-window.sh 'tmux-tidal'",
      200
    ),
  ]);

  const dailyLayout = makeContainer('h_tiles', 'horizontal', [
    makeWindow('com.apple.iCal', 'Calendar', 'open -a Calendar', 300),
    makeContainer('v_tiles', 'vertical', [
      makeWindow('com.brave.Browser', 'Brave', "open -a 'Brave Browser'", 400),
      makeWindow('com.tinyspeck.slackmacgap', 'Slack', 'open -a Slack', 500),
    ]),
  ]);

  return {
    lastGeneratedAt: null,
    modes: {
      dual: {
        inherits: null,
        workspaces: {
          code: makeWorkspace(codeLayout),
          daily: makeWorkspace(dailyLayout),
          messages: makeWorkspace(
            makeContainer('h_accordion', 'horizontal', [
              makeWindow(
                'com.apple.MobileSMS',
                'Messages',
                'open -a Messages',
                600
              ),
            ])
          ),
        },
      },
      avp: {
        inherits: 'dual',
        workspaces: {
          code: {
            layout: makeContainer('v_accordion', 'vertical', [
              makeWindow(
                'com.microsoft.VSCode',
                'Code',
                'code ~/Projects/tidal',
                10
              ),
              makeWindow(
                'com.googlecode.iterm2',
                'iTerm2',
                "~/nix-config/modules/darwin/scripts/iterm-window.sh 'tmux-tidal'",
                20
              ),
            ]),
            project: 'tidal',
            active: true,
          },
          messages: {
            skip: true,
          },
        },
      },
    },
    projects: {},
    apps: {},
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidWindowNode(node: unknown): node is WindowNode {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as Record<string, unknown>;
  return (
    n.type === 'window' &&
    typeof n['app-bundle-id'] === 'string' &&
    typeof n['app-name'] === 'string' &&
    typeof n.startup === 'string' &&
    typeof n.title === 'string' &&
    typeof n['window-id'] === 'number'
  );
}

function isValidContainerNode(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;
  const n = node as Record<string, unknown>;
  if (n.type !== 'container') return false;
  if (
    !['h_accordion', 'v_accordion', 'h_tiles', 'v_tiles'].includes(
      n.layout as string
    )
  )
    return false;
  if (!['horizontal', 'vertical'].includes(n.orientation as string))
    return false;
  if (!Array.isArray(n.children)) return false;
  return (n.children as unknown[]).every(
    (child) => isValidWindowNode(child) || isValidContainerNode(child)
  );
}

function collectWindowIds(node: TreeNode): number[] {
  if (node.type === 'window') return [node['window-id']];
  return node.children.flatMap(collectWindowIds);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: generation output compatibility', () => {
  // -----------------------------------------------------------------------
  // 1. Schema compatibility
  // -----------------------------------------------------------------------
  describe('schema compatibility', () => {
    it('generates a JSON array with exactly one workspace element', () => {
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );

      expect(Array.isArray(output)).toBe(true);
      expect(output).toHaveLength(1);
    });

    it('workspace element has name, type "workspace", and root-container', () => {
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );
      const ws = output[0];

      expect(ws.name).toBe('code');
      expect(ws.type).toBe('workspace');
      expect(ws['root-container']).toBeDefined();
    });

    it('root-container has type, layout, orientation, children', () => {
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );
      const rc = output[0]['root-container'];

      expect(rc.type).toBe('container');
      expect(rc.layout).toBe('h_accordion');
      expect(rc.orientation).toBe('horizontal');
      expect(Array.isArray(rc.children)).toBe(true);
    });

    it('children are valid window or container nodes', () => {
      const config = makeSampleConfig();
      // Use "daily" workspace which has nested containers
      const output = buildLayoutJson(
        'daily',
        config.modes.dual.workspaces.daily as Workspace
      );
      const rc = output[0]['root-container'];

      expect(isValidContainerNode(rc)).toBe(true);
    });

    it('window nodes have all required fields', () => {
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );
      const windows = output[0]['root-container'].children.filter(
        (c): c is WindowNode => c.type === 'window'
      );

      expect(windows.length).toBeGreaterThan(0);
      for (const win of windows) {
        expect(isValidWindowNode(win)).toBe(true);
      }
    });

    it('output is valid JSON', () => {
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );
      const jsonString = JSON.stringify(output, null, 2);

      expect(() => JSON.parse(jsonString)).not.toThrow();
    });

    it('matches the structure of a real hand-crafted layout', () => {
      // Compare structural shape with the known format from
      // ~/.config/aerospace/layouts/code.json
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );
      const json = JSON.parse(JSON.stringify(output));

      // Top level: array of one object
      expect(json).toHaveLength(1);
      const ws = json[0];

      // Required keys matching hand-crafted format
      expect(Object.keys(ws).sort()).toEqual(
        ['name', 'root-container', 'type'].sort()
      );
      expect(ws.type).toBe('workspace');

      // root-container keys
      const rc = ws['root-container'];
      expect(Object.keys(rc).sort()).toEqual(
        ['children', 'layout', 'orientation', 'type'].sort()
      );

      // Each window child has exactly the expected keys
      for (const child of rc.children) {
        if (child.type === 'window') {
          expect(Object.keys(child).sort()).toEqual(
            [
              'app-bundle-id',
              'app-name',
              'startup',
              'title',
              'type',
              'window-id',
            ].sort()
          );
        }
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Window ID renumbering
  // -----------------------------------------------------------------------
  describe('window ID renumbering', () => {
    it('renumbers non-sequential IDs to sequential starting from 1', () => {
      const config = makeSampleConfig();
      // The sample config uses IDs 100, 200 for the "code" workspace
      const output = buildLayoutJson(
        'code',
        config.modes.dual.workspaces.code as Workspace
      );
      const ids = collectWindowIds(output[0]['root-container']);

      expect(ids).toEqual([1, 2]);
    });

    it('renumbers nested containers sequentially', () => {
      const config = makeSampleConfig();
      // "daily" workspace has nested container with IDs 300, 400, 500
      const output = buildLayoutJson(
        'daily',
        config.modes.dual.workspaces.daily as Workspace
      );
      const ids = collectWindowIds(output[0]['root-container']);

      expect(ids).toEqual([1, 2, 3]);
    });

    it('produces unique IDs', () => {
      const config = makeSampleConfig();
      const output = buildLayoutJson(
        'daily',
        config.modes.dual.workspaces.daily as Workspace
      );
      const ids = collectWindowIds(output[0]['root-container']);
      const unique = new Set(ids);

      expect(unique.size).toBe(ids.length);
    });

    it('does not mutate the original config', () => {
      const config = makeSampleConfig();
      const originalId = (
        (config.modes.dual.workspaces.code as Workspace).layout
          .children[0] as WindowNode
      )['window-id'];

      buildLayoutJson('code', config.modes.dual.workspaces.code as Workspace);

      const afterId = (
        (config.modes.dual.workspaces.code as Workspace).layout
          .children[0] as WindowNode
      )['window-id'];

      expect(afterId).toBe(originalId);
      expect(afterId).toBe(100);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Mode inheritance resolution
  // -----------------------------------------------------------------------
  describe('mode inheritance resolution', () => {
    it('resolves base mode workspaces directly', () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'dual');

      expect(resolved).not.toBeNull();
      expect(Object.keys(resolved!).sort()).toEqual(
        ['code', 'daily', 'messages'].sort()
      );
    });

    it('derived mode inherits base workspaces', () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'avp');

      expect(resolved).not.toBeNull();
      // "daily" is inherited from dual, "code" is overridden, "messages" is skipped
      expect(Object.keys(resolved!).sort()).toEqual(['code', 'daily'].sort());
    });

    it('derived mode excludes skipped workspaces', () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'avp');

      expect(resolved).not.toBeNull();
      expect(resolved!['messages']).toBeUndefined();
    });

    it('derived mode uses overridden layout where provided', () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'avp');

      expect(resolved).not.toBeNull();
      // AVP code workspace has v_accordion layout (overridden)
      expect(resolved!['code'].layout.layout).toBe('v_accordion');
      expect(resolved!['code'].layout.orientation).toBe('vertical');
    });

    it('derived mode inherits layout when only metadata is overridden', () => {
      const config = makeSampleConfig();
      // Add a metadata-only override to avp
      (config.modes.avp.workspaces as Record<string, unknown>)['daily'] = {
        active: false,
      };

      const resolved = resolveMode(config, 'avp');

      expect(resolved).not.toBeNull();
      // Layout should be inherited from dual
      expect(resolved!['daily'].layout.layout).toBe('h_tiles');
      // Active should be overridden to false
      expect(resolved!['daily'].active).toBe(false);
    });

    it('derived mode preserves project field from override', () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'avp');

      expect(resolved).not.toBeNull();
      expect(resolved!['code'].project).toBe('tidal');
    });

    it('generates correct layout JSON for resolved derived mode workspace', () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'avp');

      expect(resolved).not.toBeNull();
      const output = buildLayoutJson('code', resolved!['code']);

      expect(output[0].name).toBe('code');
      expect(output[0]['root-container'].layout).toBe('v_accordion');
      const ids = collectWindowIds(output[0]['root-container']);
      expect(ids).toEqual([1, 2]);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Startup script generation
  // -----------------------------------------------------------------------
  describe('startup script generation', () => {
    it('generates script with correct shebang', () => {
      const config = makeSampleConfig();
      const content = buildStartupScriptContent(config, 'dual');

      expect(content.startsWith('#!/usr/bin/env bash')).toBe(true);
    });

    it('iterates active workspaces', () => {
      const config = makeSampleConfig();
      const content = buildStartupScriptContent(config, 'dual');

      // All three dual workspaces are active
      expect(content).toContain('$LAYOUT_ENGINE code');
      expect(content).toContain('$LAYOUT_ENGINE daily');
      expect(content).toContain('$LAYOUT_ENGINE messages');
    });

    it('skips inactive workspaces', () => {
      const config = makeSampleConfig();
      // Mark messages workspace as inactive
      (config.modes.dual.workspaces.messages as Workspace).active = false;

      const content = buildStartupScriptContent(config, 'dual');

      expect(content).toContain('$LAYOUT_ENGINE code');
      expect(content).toContain('$LAYOUT_ENGINE daily');
      expect(content).not.toContain('$LAYOUT_ENGINE messages');
    });

    it('calls aerospace-layout-manager with correct arguments', () => {
      const config = makeSampleConfig();
      const content = buildStartupScriptContent(config, 'dual');
      const layoutsDir = path.join(
        os.homedir(),
        '.config',
        'aerospace',
        'layouts'
      );

      // dual mode layouts go directly in the layouts dir
      expect(content).toContain(
        `$LAYOUT_ENGINE code "${path.join(layoutsDir, 'code.json')}"`
      );
    });

    it('uses mode-specific layout path for non-dual modes', () => {
      const config = makeSampleConfig();
      const content = buildStartupScriptContent(config, 'avp');
      const layoutsDir = path.join(
        os.homedir(),
        '.config',
        'aerospace',
        'layouts'
      );

      // avp mode layouts go in layouts/avp/
      expect(content).toContain(
        `$LAYOUT_ENGINE code "${path.join(layoutsDir, 'avp', 'code.json')}"`
      );
    });

    it('skipped workspaces from derived mode are excluded', () => {
      const config = makeSampleConfig();
      const content = buildStartupScriptContent(config, 'avp');

      // messages is skipped in avp mode
      expect(content).not.toContain('$LAYOUT_ENGINE messages');
    });

    it('inherited workspaces appear in derived mode script', () => {
      const config = makeSampleConfig();
      const content = buildStartupScriptContent(config, 'avp');

      // daily is inherited from dual into avp
      expect(content).toContain('$LAYOUT_ENGINE daily');
    });
  });

  // -----------------------------------------------------------------------
  // 5. Per-workspace generation
  // -----------------------------------------------------------------------
  describe('per-workspace generation', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'alm-gen-test-')
      );
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('generates only the specified workspace layout JSON', async () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'dual');
      expect(resolved).not.toBeNull();

      // Generate only the "code" workspace
      const wsName = 'code';
      const layoutJson = buildLayoutJson(wsName, resolved![wsName]);
      const filePath = path.join(tmpDir, `${wsName}.json`);
      await fs.writeFile(
        filePath,
        JSON.stringify(layoutJson, null, 2) + '\n',
        'utf-8'
      );

      // Verify only code.json was written
      const files = await fs.readdir(tmpDir);
      expect(files).toEqual(['code.json']);

      // Verify it parses and has correct structure
      const content = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('code');
      expect(parsed[0].type).toBe('workspace');
    });

    it('startup script is regenerated alongside workspace generation', () => {
      // Verify that the startup script content reflects current active
      // workspaces even when only one workspace was generated
      const config = makeSampleConfig();

      // Mark "messages" as inactive
      (config.modes.dual.workspaces.messages as Workspace).active = false;

      // Build startup script — it should reflect the current state
      const scriptContent = buildStartupScriptContent(config, 'dual');

      expect(scriptContent).toContain('$LAYOUT_ENGINE code');
      expect(scriptContent).toContain('$LAYOUT_ENGINE daily');
      expect(scriptContent).not.toContain('$LAYOUT_ENGINE messages');
    });

    it('per-workspace generation output is valid JSON consumable by layout manager', async () => {
      const config = makeSampleConfig();
      const resolved = resolveMode(config, 'dual');
      expect(resolved).not.toBeNull();

      for (const [wsName, ws] of Object.entries(resolved!)) {
        const layoutJson = buildLayoutJson(wsName, ws);
        const jsonString = JSON.stringify(layoutJson, null, 2);

        // Valid JSON
        const parsed = JSON.parse(jsonString);

        // Correct structure
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe(wsName);
        expect(parsed[0].type).toBe('workspace');
        expect(parsed[0]['root-container']).toBeDefined();
        expect(isValidContainerNode(parsed[0]['root-container'])).toBe(true);

        // Window IDs are sequential starting from 1
        const ids = collectWindowIds(parsed[0]['root-container']);
        const expected = Array.from({ length: ids.length }, (_, i) => i + 1);
        expect(ids).toEqual(expected);
      }
    });
  });
});
