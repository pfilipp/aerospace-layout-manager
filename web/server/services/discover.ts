import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readConfig, writeConfig } from "./config.js";
import type { AppEntry } from "../types.js";

const execFileAsync = promisify(execFile);

export type AppRegistry = Record<string, AppEntry>;

/**
 * Execute `aerospace list-windows --all`, parse the pipe-delimited output,
 * and merge newly discovered apps into the config's app registry.
 *
 * Output format from aerospace: window-id | app-bundle-id | app-name | workspace | title
 * Each column is separated by " | " (pipe with surrounding spaces).
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
 * Returns a map of bundle-id -> AppEntry for newly discovered apps.
 */
function parseAerospaceOutput(stdout: string): AppRegistry {
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

    if (!bundleId || !appName) continue;

    // Only add each bundle ID once
    if (!(bundleId in apps)) {
      apps[bundleId] = {
        name: appName,
        source: "discovered",
        defaultStartup: `open -a '${appName}'`,
      };
    }
  }

  return apps;
}
