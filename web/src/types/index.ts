/**
 * Frontend type definitions re-exported from server types.
 * These mirror the server/types.ts definitions for use in React components.
 */

// --- Layout tree nodes ---

export interface WindowNode {
  type: 'window';
  'app-bundle-id': string;
  'app-name': string;
  startup: string;
  title: string;
  'window-id': number;
}

export interface ContainerNode {
  type: 'container';
  layout: LayoutType;
  orientation: Orientation;
  children: TreeNode[];
}

export type TreeNode = WindowNode | ContainerNode;

export type LayoutType = 'h_accordion' | 'v_accordion' | 'h_tiles' | 'v_tiles';
export type Orientation = 'horizontal' | 'vertical';

// --- Workspace ---

export interface Workspace {
  layout: ContainerNode;
  project: string | null;
  active: boolean;
}

export interface WorkspaceOverride {
  layout?: ContainerNode;
  project?: string | null;
  active?: boolean;
  skip?: boolean;
}

// --- Mode ---

export interface Mode {
  inherits: string | null;
  workspaces: Record<string, Workspace | WorkspaceOverride>;
}

/** Mode summary returned by GET /api/modes */
export interface ModeSummary {
  name: string;
  inherits: string | null;
  workspaceCount: number;
}

// --- Project ---

export interface Project {
  name: string;
  dir: string;
  subdir: string;
  iterm_cmd: string;
  xcodeproj: string;
  apps: string[];
}

// --- App registry ---

export type AppSource = 'seed' | 'discovered';

export interface AppEntry {
  name: string;
  source: AppSource;
  defaultStartup: string;
}

// --- Resolved workspace (for display in sidebar) ---

export interface ResolvedWorkspace {
  name: string;
  active: boolean;
  project: string | null;
  /** Whether this workspace is inherited from a base mode */
  inherited: boolean;
  /** Whether this workspace has a local override in the current mode */
  overridden: boolean;
}
