/**
 * Shared types for the AeroSpace Layout Manager Web UI.
 * These types model the config.json data structure.
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

/**
 * A workspace override in a derived mode.
 * May contain only metadata fields (e.g., { active: false }) without a layout,
 * in which case the layout is inherited from the base mode.
 * May contain { skip: true } to exclude the workspace from the derived mode.
 */
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

// --- Top-level config ---

export interface Config {
  lastGeneratedAt: string | null;
  modes: Record<string, Mode>;
  projects: Record<string, Project>;
  apps: Record<string, AppEntry>;
}

// --- Layout JSON output format (what aerospace-layout-manager consumes) ---

export interface LayoutJsonWorkspace {
  name: string;
  type: 'workspace';
  'root-container': ContainerNode;
}

/** A layout JSON file is an array with exactly one workspace object. */
export type LayoutJsonFile = [LayoutJsonWorkspace];
