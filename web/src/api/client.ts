/**
 * API client functions for the AeroSpace Layout Manager backend.
 * These are placeholder fetch functions that will be replaced by TanStack Query in T14.
 */

import type {
  ModeSummary,
  Mode,
  Project,
  AppEntry,
  ResolvedWorkspace,
} from '../types';

const BASE_URL = '/api';

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${url}`, {
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }
  return response.json();
}

// --- Modes ---

export async function fetchModes(): Promise<ModeSummary[]> {
  const raw = await fetchJson<Record<string, { inherits: string | null; workspaceCount: number }>>('/modes');
  return Object.entries(raw).map(([name, data]) => ({
    name,
    inherits: data.inherits,
    workspaceCount: data.workspaceCount,
  }));
}

export async function fetchMode(mode: string): Promise<Mode> {
  return fetchJson<Mode>(`/modes/${encodeURIComponent(mode)}`);
}

// --- Workspaces ---

export async function fetchWorkspaces(mode: string): Promise<ResolvedWorkspace[]> {
  const modeData = await fetchMode(mode);
  const baseMode = modeData.inherits
    ? await fetchMode(modeData.inherits)
    : null;

  const workspaces: ResolvedWorkspace[] = [];
  const modeWorkspaces = modeData.workspaces;

  if (baseMode && modeData.inherits) {
    // Derived mode: merge base + overrides
    for (const [name, ws] of Object.entries(baseMode.workspaces)) {
      const override = modeWorkspaces[name];
      if (override && 'skip' in override && override.skip) {
        continue; // Skipped in derived mode
      }
      const resolved: ResolvedWorkspace = {
        name,
        active: override && 'active' in override ? override.active ?? true : ('active' in ws ? (ws as { active: boolean }).active : true),
        project: override && 'project' in override ? override.project ?? null : ('project' in ws ? (ws as { project: string | null }).project : null),
        inherited: !override || !('layout' in override),
        overridden: !!override,
      };
      workspaces.push(resolved);
    }
    // Add workspaces only in derived mode (not in base)
    for (const [name, ws] of Object.entries(modeWorkspaces)) {
      if (name in (baseMode.workspaces || {})) continue;
      if ('skip' in ws && ws.skip) continue;
      workspaces.push({
        name,
        active: 'active' in ws ? ws.active ?? true : true,
        project: 'project' in ws ? ws.project ?? null : null,
        inherited: false,
        overridden: false,
      });
    }
  } else {
    // Base mode
    for (const [name, ws] of Object.entries(modeWorkspaces)) {
      workspaces.push({
        name,
        active: 'active' in ws ? ws.active ?? true : true,
        project: 'project' in ws ? ws.project ?? null : null,
        inherited: false,
        overridden: false,
      });
    }
  }

  return workspaces;
}

// --- Projects ---

export async function fetchProjects(): Promise<Record<string, Project>> {
  return fetchJson<Record<string, Project>>('/projects');
}

export async function saveProject(name: string, project: Project): Promise<void> {
  await fetchJson(`/projects/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify(project),
  });
}

export async function deleteProject(name: string): Promise<void> {
  await fetchJson(`/projects/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// --- Apps ---

export async function fetchApps(): Promise<Record<string, AppEntry>> {
  return fetchJson<Record<string, AppEntry>>('/apps');
}

export async function discoverApps(): Promise<Record<string, AppEntry>> {
  return fetchJson<Record<string, AppEntry>>('/apps/discover', {
    method: 'POST',
  });
}
