/**
 * Migration service — import existing layout JSONs and projects into config.json
 *
 * Provides:
 * - previewMigration(): read-only scan returning counts and warnings
 * - executeMigration(): perform the actual import and write to config.json
 *
 * Source files:
 * - ~/.config/aerospace/projects.json     — existing project definitions
 * - ~/.config/aerospace/layouts/*.json    — dual mode layout files
 * - ~/.config/aerospace/layouts/avp/*.json — avp mode layout files
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig, CONFIG_DIR } from './config.js';
import type {
  Config,
  Project,
  Workspace,
  ContainerNode,
  LayoutJsonFile,
} from '../types.js';

// --- Paths ---

const LAYOUTS_DIR = path.join(CONFIG_DIR, 'layouts');
const AVP_LAYOUTS_DIR = path.join(LAYOUTS_DIR, 'avp');
const PROJECTS_PATH = path.join(CONFIG_DIR, 'projects.json');

// Nix-managed static layouts (fallback source for workspaces not in ~/.config)
const NIX_LAYOUTS_DIR = path.join(
  os.homedir(),
  'nix-config/modules/darwin/scripts/layouts'
);
const NIX_AVP_LAYOUTS_DIR = path.join(NIX_LAYOUTS_DIR, 'avp');

// --- Known fields for validation ---

const KNOWN_PROJECT_FIELDS = new Set([
  'name',
  'dir',
  'subdir',
  'iterm_cmd',
  'xcodeproj',
  'apps',
]);

const KNOWN_LAYOUT_TOP_FIELDS = new Set(['name', 'type', 'root-container']);

const KNOWN_NODE_FIELDS = new Set([
  'type',
  'layout',
  'orientation',
  'children',
  'app-bundle-id',
  'app-name',
  'startup',
  'title',
  'window-id',
]);

// --- Types ---

export interface MigrationWarning {
  file: string;
  message: string;
}

export interface MigrationPreview {
  modes: {
    name: string;
    workspaceCount: number;
    workspaces: string[];
  }[];
  projectCount: number;
  projects: string[];
  warnings: MigrationWarning[];
  existingConfigHasData: boolean;
}

export interface MigrationResult {
  modesCreated: string[];
  workspacesImported: Record<string, string[]>;
  projectsImported: string[];
  warnings: MigrationWarning[];
}

// --- Helpers ---

/**
 * Safely read and parse a JSON file. Returns null if file doesn't exist or is invalid.
 */
async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * List JSON files in a directory. Returns empty array if directory doesn't exist.
 */
async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((f) => f.endsWith('.json'))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Check a tree node recursively for unknown fields, collecting warnings.
 */
function checkNodeFields(
  node: Record<string, unknown>,
  filePath: string,
  warnings: MigrationWarning[],
  nodePath: string
): void {
  for (const key of Object.keys(node)) {
    if (!KNOWN_NODE_FIELDS.has(key)) {
      warnings.push({
        file: filePath,
        message: `Unknown field "${key}" at ${nodePath}`,
      });
    }
  }

  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i] as Record<string, unknown>;
      if (child && typeof child === 'object') {
        checkNodeFields(child, filePath, warnings, `${nodePath}.children[${i}]`);
      }
    }
  }
}

/**
 * Parse a layout JSON file and extract workspace name + layout tree.
 * Returns null with warnings if the file is invalid.
 */
function parseLayoutFile(
  data: unknown,
  filePath: string,
  warnings: MigrationWarning[]
): { name: string; layout: ContainerNode } | null {
  if (!Array.isArray(data) || data.length === 0) {
    warnings.push({
      file: filePath,
      message: 'Layout file is not a non-empty array',
    });
    return null;
  }

  const wsObj = data[0] as Record<string, unknown>;
  if (!wsObj || typeof wsObj !== 'object') {
    warnings.push({
      file: filePath,
      message: 'First element is not an object',
    });
    return null;
  }

  // Check for unknown top-level fields
  for (const key of Object.keys(wsObj)) {
    if (!KNOWN_LAYOUT_TOP_FIELDS.has(key)) {
      warnings.push({
        file: filePath,
        message: `Unknown top-level field "${key}"`,
      });
    }
  }

  const name = wsObj.name;
  if (typeof name !== 'string' || !name) {
    warnings.push({
      file: filePath,
      message: 'Missing or invalid "name" field',
    });
    return null;
  }

  const rootContainer = wsObj['root-container'] as ContainerNode;
  if (!rootContainer || typeof rootContainer !== 'object') {
    warnings.push({
      file: filePath,
      message: 'Missing or invalid "root-container" field',
    });
    return null;
  }

  // Check node fields recursively
  checkNodeFields(
    rootContainer as unknown as Record<string, unknown>,
    filePath,
    warnings,
    'root-container'
  );

  return { name, layout: rootContainer };
}

/**
 * Parse projects.json and extract project definitions.
 */
function parseProjectsFile(
  data: unknown,
  filePath: string,
  warnings: MigrationWarning[]
): Record<string, Project> {
  const projects: Record<string, Project> = {};

  if (!data || typeof data !== 'object') {
    warnings.push({
      file: filePath,
      message: 'Projects file is not an object',
    });
    return projects;
  }

  // projects.json has a top-level "projects" key wrapping the map
  const raw = data as Record<string, unknown>;
  const projectsMap = (raw.projects ?? raw) as Record<string, unknown>;

  if (typeof projectsMap !== 'object' || projectsMap === null) {
    warnings.push({
      file: filePath,
      message: 'Could not find projects map in file',
    });
    return projects;
  }

  for (const [key, value] of Object.entries(projectsMap)) {
    if (!value || typeof value !== 'object') {
      warnings.push({
        file: filePath,
        message: `Project "${key}" is not an object`,
      });
      continue;
    }

    const proj = value as Record<string, unknown>;

    // Check for unknown fields
    for (const field of Object.keys(proj)) {
      if (!KNOWN_PROJECT_FIELDS.has(field)) {
        warnings.push({
          file: filePath,
          message: `Unknown field "${field}" in project "${key}"`,
        });
      }
    }

    const name = typeof proj.name === 'string' ? proj.name : key;
    const dir = typeof proj.dir === 'string' ? proj.dir : '';

    if (!dir) {
      warnings.push({
        file: filePath,
        message: `Project "${key}" has no "dir" field`,
      });
    }

    projects[name] = {
      name,
      dir,
      subdir: typeof proj.subdir === 'string' ? proj.subdir : '',
      iterm_cmd: typeof proj.iterm_cmd === 'string' ? proj.iterm_cmd : '',
      xcodeproj: typeof proj.xcodeproj === 'string' ? proj.xcodeproj : '',
      apps: Array.isArray(proj.apps) ? (proj.apps as string[]) : [],
    };
  }

  return projects;
}

/**
 * Scan layout files from a directory and parse them into workspaces.
 */
async function scanLayoutDir(
  dir: string,
  warnings: MigrationWarning[]
): Promise<Record<string, Workspace>> {
  const workspaces: Record<string, Workspace> = {};
  const files = await listJsonFiles(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const data = await readJsonFile(filePath);

    if (data === null) {
      warnings.push({
        file: filePath,
        message: 'Could not read or parse file',
      });
      continue;
    }

    const parsed = parseLayoutFile(data, filePath, warnings);
    if (!parsed) continue;

    workspaces[parsed.name] = {
      layout: parsed.layout,
      project: null,
      active: true,
    };
  }

  return workspaces;
}

/**
 * Check whether the existing config has any meaningful data
 * (modes with workspaces, or projects).
 */
function configHasData(config: Config): boolean {
  const hasModes = Object.values(config.modes).some(
    (m) => Object.keys(m.workspaces).length > 0
  );
  const hasProjects = Object.keys(config.projects).length > 0;
  return hasModes || hasProjects;
}

// --- Public API ---

/**
 * Preview migration — read-only scan returning counts, workspace names,
 * project names, and warnings. Does NOT write any files.
 */
export async function previewMigration(): Promise<MigrationPreview> {
  const warnings: MigrationWarning[] = [];

  // Scan dual layouts (config dir + nix-managed fallback)
  const dualWorkspaces = await scanLayoutDir(LAYOUTS_DIR, warnings);
  const nixDualWorkspaces = await scanLayoutDir(NIX_LAYOUTS_DIR, warnings);
  for (const [name, ws] of Object.entries(nixDualWorkspaces)) {
    if (!dualWorkspaces[name]) {
      dualWorkspaces[name] = ws;
    }
  }

  // Scan avp layouts (config dir + nix-managed fallback)
  const avpWorkspaces = await scanLayoutDir(AVP_LAYOUTS_DIR, warnings);
  const nixAvpWorkspaces = await scanLayoutDir(NIX_AVP_LAYOUTS_DIR, warnings);
  for (const [name, ws] of Object.entries(nixAvpWorkspaces)) {
    if (!avpWorkspaces[name]) {
      avpWorkspaces[name] = ws;
    }
  }

  // Scan projects
  const projectsData = await readJsonFile(PROJECTS_PATH);
  let projects: Record<string, Project> = {};
  if (projectsData !== null) {
    projects = parseProjectsFile(projectsData, PROJECTS_PATH, warnings);
  } else {
    warnings.push({
      file: PROJECTS_PATH,
      message: 'Projects file not found or could not be read',
    });
  }

  // Check existing config for data
  let existingConfigHasData = false;
  try {
    const config = await readConfig();
    existingConfigHasData = configHasData(config);
  } catch {
    // Config doesn't exist yet — that's fine
  }

  // Build modes list
  const modes: MigrationPreview['modes'] = [];

  const dualWsNames = Object.keys(dualWorkspaces);
  if (dualWsNames.length > 0) {
    modes.push({
      name: 'dual',
      workspaceCount: dualWsNames.length,
      workspaces: dualWsNames,
    });
  }

  const avpWsNames = Object.keys(avpWorkspaces);
  if (avpWsNames.length > 0) {
    modes.push({
      name: 'avp',
      workspaceCount: avpWsNames.length,
      workspaces: avpWsNames,
    });
  }

  return {
    modes,
    projectCount: Object.keys(projects).length,
    projects: Object.keys(projects),
    warnings,
    existingConfigHasData,
  };
}

/**
 * Execute migration — import existing layout JSONs and projects into config.json.
 * Merges carefully with existing config data (does not silently overwrite).
 */
export async function executeMigration(): Promise<MigrationResult> {
  const warnings: MigrationWarning[] = [];
  const modesCreated: string[] = [];
  const workspacesImported: Record<string, string[]> = {};
  const projectsImported: string[] = [];

  // Read or create config
  let config: Config;
  try {
    config = await readConfig();
  } catch {
    // Config doesn't exist — use the default
    const { createDefaultConfig } = await import('./config.js');
    config = createDefaultConfig();
  }

  // --- Import projects ---

  const projectsData = await readJsonFile(PROJECTS_PATH);
  if (projectsData !== null) {
    const parsedProjects = parseProjectsFile(projectsData, PROJECTS_PATH, warnings);

    for (const [name, project] of Object.entries(parsedProjects)) {
      if (config.projects[name]) {
        warnings.push({
          file: PROJECTS_PATH,
          message: `Project "${name}" already exists in config — skipping (not overwriting)`,
        });
        continue;
      }
      config.projects[name] = project;
      projectsImported.push(name);
    }
  } else {
    warnings.push({
      file: PROJECTS_PATH,
      message: 'Projects file not found — skipping project import',
    });
  }

  // --- Import dual mode layouts (config dir + nix-managed fallback) ---

  const dualWorkspaces = await scanLayoutDir(LAYOUTS_DIR, warnings);
  const nixDualWs = await scanLayoutDir(NIX_LAYOUTS_DIR, warnings);
  for (const [name, ws] of Object.entries(nixDualWs)) {
    if (!dualWorkspaces[name]) {
      dualWorkspaces[name] = ws;
    }
  }
  const dualWsNames = Object.keys(dualWorkspaces);

  if (dualWsNames.length > 0) {
    // Create dual mode if it doesn't exist
    if (!config.modes.dual) {
      config.modes.dual = {
        inherits: null,
        workspaces: {},
      };
      modesCreated.push('dual');
    }

    workspacesImported.dual = [];
    for (const [wsName, ws] of Object.entries(dualWorkspaces)) {
      if (config.modes.dual.workspaces[wsName]) {
        warnings.push({
          file: path.join(LAYOUTS_DIR, `${wsName}.json`),
          message: `Workspace "${wsName}" already exists in dual mode — skipping (not overwriting)`,
        });
        continue;
      }
      config.modes.dual.workspaces[wsName] = ws;
      workspacesImported.dual.push(wsName);
    }
  }

  // --- Import avp mode layouts (config dir + nix-managed fallback) ---

  const avpWorkspaces = await scanLayoutDir(AVP_LAYOUTS_DIR, warnings);
  const nixAvpWs = await scanLayoutDir(NIX_AVP_LAYOUTS_DIR, warnings);
  for (const [name, ws] of Object.entries(nixAvpWs)) {
    if (!avpWorkspaces[name]) {
      avpWorkspaces[name] = ws;
    }
  }
  const avpWsNames = Object.keys(avpWorkspaces);

  if (avpWsNames.length > 0) {
    // Create avp mode if it doesn't exist
    if (!config.modes.avp) {
      config.modes.avp = {
        inherits: 'dual',
        workspaces: {},
      };
      modesCreated.push('avp');
    }

    workspacesImported.avp = [];
    for (const [wsName, ws] of Object.entries(avpWorkspaces)) {
      if (config.modes.avp.workspaces[wsName]) {
        warnings.push({
          file: path.join(AVP_LAYOUTS_DIR, `${wsName}.json`),
          message: `Workspace "${wsName}" already exists in avp mode — skipping (not overwriting)`,
        });
        continue;
      }
      config.modes.avp.workspaces[wsName] = ws;
      workspacesImported.avp.push(wsName);
    }
  }

  // --- Write config ---

  await writeConfig(config);

  return {
    modesCreated,
    workspacesImported,
    projectsImported,
    warnings,
  };
}
