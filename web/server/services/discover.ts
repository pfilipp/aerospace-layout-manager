import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfig, writeConfig } from "./config.js";
import type { AppEntry } from "../types.js";

const execFileAsync = promisify(execFile);

export type AppRegistry = Record<string, AppEntry>;

const DISCOVER_FORMAT =
  "%{window-id}|%{app-bundle-id}|%{app-name}|%{workspace}|%{window-title}";

/**
 * Execute `aerospace list-windows --all` with an explicit --format, parse the
 * pipe-delimited output, and merge newly discovered apps into the config's
 * app registry.
 *
 * Output columns: window-id | app-bundle-id | app-name | workspace | title
 *
 * Returns the updated app registry.
 * Throws if aerospace is not running or the command fails.
 */
export async function discoverApps(): Promise<AppRegistry> {
  let stdout: string;

  try {
    const result = await execFileAsync("aerospace", [
      "list-windows",
      "--all",
      "--format",
      DISCOVER_FORMAT,
    ]);
    stdout = result.stdout;
  } catch {
    throw new Error(
      "AeroSpace must be running for app discovery to work"
    );
  }

  const discoveredApps = parseAerospaceOutput(stdout);

  // Read current config and merge
  const config = await readConfig();
  const apps: AppRegistry = config.apps ?? {};

  for (const [bundleId, appInfo] of Object.entries(discoveredApps)) {
    // Do NOT overwrite existing apps
    if (!(bundleId in apps)) {
      apps[bundleId] = appInfo;
    }
  }

  config.apps = apps;
  await writeConfig(config);

  return apps;
}

/**
 * Parse the pipe-delimited output from `aerospace list-windows --all`.
 * Each line: window-id | app-bundle-id | app-name | workspace | title
 *
 * Rows without a bundle-id (e.g. Chrome PWAs like Google Meet) get a
 * synthesized key of the form `app-name:<appName>` so they still surface
 * in the registry.
 *
 * Returns a map of registry-key -> AppEntry for newly discovered apps.
 */
export function parseAerospaceOutput(stdout: string): AppRegistry {
  const apps: AppRegistry = {};
  const lines = stdout.trim().split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length < 3) continue;

    // parts[0] = window-id, parts[1] = app-bundle-id, parts[2] = app-name
    const bundleId = parts[1];
    const appName = parts[2];

    if (!appName) continue;

    const key = bundleId || `app-name:${appName}`;

    if (!(key in apps)) {
      apps[key] = {
        name: appName,
        source: "discovered",
        defaultStartup: `open -a '${appName}'`,
      };
    }
  }

  return apps;
}
