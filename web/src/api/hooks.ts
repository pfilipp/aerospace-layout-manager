/**
 * TanStack Query hooks for all backend API endpoints.
 * Provides queries, mutations, cache invalidation, and optimistic updates.
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type {
  ModeSummary,
  Mode,
  Project,
  AppEntry,
  ResolvedWorkspace,
  ContainerNode,
  Workspace,
} from '../types';
import {
  fetchModes,
  fetchMode,
  fetchWorkspaces,
  fetchProjects,
  fetchApps,
  fetchJson,
} from './client';

// --- Query key factories ---

export const queryKeys = {
  modes: () => ['modes'] as const,
  mode: (name: string) => ['modes', name] as const,
  workspaces: (mode: string) => ['workspaces', mode] as const,
  workspace: (mode: string, ws: string) => ['workspaces', mode, ws] as const,
  projects: () => ['projects'] as const,
  apps: () => ['apps'] as const,
  config: () => ['config'] as const,
  migrationPreview: () => ['migration', 'preview'] as const,
};

// --- Query hooks ---

export function useModes() {
  return useQuery({
    queryKey: queryKeys.modes(),
    queryFn: fetchModes,
  });
}

export function useMode(modeName: string | null) {
  return useQuery({
    queryKey: queryKeys.mode(modeName ?? ''),
    queryFn: () => fetchMode(modeName!),
    enabled: !!modeName,
  });
}

export function useWorkspaces(modeName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspaces(modeName ?? ''),
    queryFn: () => fetchWorkspaces(modeName!),
    enabled: !!modeName,
  });
}

export function useWorkspace(modeName: string | null, wsName: string | null) {
  return useQuery({
    queryKey: queryKeys.workspace(modeName ?? '', wsName ?? ''),
    queryFn: () =>
      fetchJson<{ layout: ContainerNode; project: string | null; active: boolean }>(
        `/modes/${encodeURIComponent(modeName!)}/workspaces/${encodeURIComponent(wsName!)}`,
      ),
    enabled: !!modeName && !!wsName,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: fetchProjects,
  });
}

export function useApps() {
  return useQuery({
    queryKey: queryKeys.apps(),
    queryFn: fetchApps,
  });
}

export function useConfig() {
  return useQuery({
    queryKey: queryKeys.config(),
    queryFn: () => fetchJson<{ lastGeneratedAt: string | null }>('/config'),
  });
}

export interface MigrationPreviewResponse {
  modes: {
    name: string;
    workspaceCount: number;
    workspaces: string[];
  }[];
  projectCount: number;
  projects: string[];
  warnings: { file: string; message: string }[];
  existingConfigHasData: boolean;
}

export function useMigrationPreview(enabled = false) {
  return useQuery({
    queryKey: queryKeys.migrationPreview(),
    queryFn: () => fetchJson<MigrationPreviewResponse>('/migrate/preview'),
    enabled,
  });
}

// --- Mutation hooks ---

export function useCreateMode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; inherits?: string | null }) =>
      fetchJson<Mode>('/modes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modes() });
    },
  });
}

export function useUpdateMode(modeName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Mode>) =>
      fetchJson<Mode>(`/modes/${encodeURIComponent(modeName)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.mode(modeName) });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(modeName) });
    },
  });
}

export function useDeleteMode(modeName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<void>(`/modes/${encodeURIComponent(modeName)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modes() });
    },
  });
}

export function useUpdateWorkspace(modeName: string, wsName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Workspace>) =>
      fetchJson<Workspace>(
        `/modes/${encodeURIComponent(modeName)}/workspaces/${encodeURIComponent(wsName)}`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(modeName) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspace(modeName, wsName),
      });
    },
  });
}

export function useDeleteWorkspace(modeName: string, wsName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<void>(
        `/modes/${encodeURIComponent(modeName)}/workspaces/${encodeURIComponent(wsName)}`,
        {
          method: 'DELETE',
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.modes() });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(modeName) });
    },
  });
}

export function useUpdateProject(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Project) =>
      fetchJson<void>(`/projects/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  });
}

export function useSaveProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Project) =>
      fetchJson<void>(`/projects/${encodeURIComponent(data.name)}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      fetchJson<void>(`/projects/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.projects() });
    },
  });
}

export function useApplyProject(modeName: string, wsName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { projectName: string }) =>
      fetchJson<{ preview: Array<{ windowId: number; oldCommand: string; newCommand: string }> }>(
        `/modes/${encodeURIComponent(modeName)}/workspaces/${encodeURIComponent(wsName)}/apply-project`,
        {
          method: 'POST',
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(modeName) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workspace(modeName, wsName),
      });
    },
  });
}

export function useDiscoverApps() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<Record<string, AppEntry>>('/apps/discover', {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.apps() });
    },
  });
}

export function useGenerate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ generatedFiles: string[] }>('/generate', {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config() });
    },
  });
}

export function useGenerateMode(modeName: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ generatedFiles: string[] }>(`/generate/${encodeURIComponent(modeName)}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.config() });
    },
  });
}

export interface MigrationResultResponse {
  modesCreated: string[];
  workspacesImported: Record<string, string[]>;
  projectsImported: string[];
  warnings: { file: string; message: string }[];
}

export function useMigrate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<MigrationResultResponse>(
        '/migrate',
        {
          method: 'POST',
        },
      ),
    onSuccess: () => {
      // Migration changes everything — invalidate all queries
      queryClient.invalidateQueries();
    },
  });
}

// --- Optimistic update helpers ---

/**
 * Hook for workspace tree edits with optimistic cache updates.
 * Updates the cache immediately and reverts on error.
 */
export function useOptimisticWorkspaceUpdate(modeName: string, wsName: string) {
  const queryClient = useQueryClient();
  const wsKey = queryKeys.workspace(modeName, wsName);

  return useMutation({
    mutationFn: (data: Partial<Workspace>) =>
      fetchJson<Workspace>(
        `/modes/${encodeURIComponent(modeName)}/workspaces/${encodeURIComponent(wsName)}`,
        {
          method: 'PUT',
          body: JSON.stringify(data),
        },
      ),
    onMutate: async (newData) => {
      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: wsKey });

      // Snapshot the previous value
      const previousWorkspace = queryClient.getQueryData(wsKey);

      // Optimistically update to the new value
      if (previousWorkspace) {
        queryClient.setQueryData(wsKey, {
          ...(previousWorkspace as Record<string, unknown>),
          ...newData,
        });
      }

      return { previousWorkspace };
    },
    onError: (_err, _newData, context) => {
      // Revert to the previous value on error
      if (context?.previousWorkspace) {
        queryClient.setQueryData(wsKey, context.previousWorkspace);
      }
    },
    onSettled: () => {
      // Refetch to ensure cache is in sync with server
      queryClient.invalidateQueries({ queryKey: wsKey });
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(modeName) });
      queryClient.invalidateQueries({ queryKey: queryKeys.modes() });
    },
  });
}
