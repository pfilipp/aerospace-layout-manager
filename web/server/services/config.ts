/**
 * Config service — read/write ~/.config/aerospace/config.json
 *
 * Provides:
 * - readConfig(): parse and return typed config
 * - writeConfig(config): atomic write (temp file + rename)
 * - ensureConfig(): create default config if missing
 * - Async mutex to serialize concurrent writes
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Config } from '../types.js';

// --- Config file path ---

const CONFIG_DIR = path.join(os.homedir(), '.config', 'aerospace');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export { CONFIG_PATH, CONFIG_DIR };

// --- Simple promise-based mutex ---

class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise<() => void>((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => this.release());
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  private release(): void {
    this.locked = false;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}

const configMutex = new AsyncMutex();

// --- Default config with seeded apps ---

export function createDefaultConfig(): Config {
  return {
    lastGeneratedAt: null,
    modes: {},
    projects: {},
    apps: {
      'com.microsoft.VSCode': {
        name: 'VS Code',
        source: 'seed',
        defaultStartup: 'code ${PROJECT_DIR}',
      },
      'com.googlecode.iterm2': {
        name: 'iTerm2',
        source: 'seed',
        defaultStartup:
          "~/nix-config/modules/darwin/scripts/iterm-window.sh '${PROJECT_ITERM_CMD}'",
      },
      'com.apple.dt.Xcode': {
        name: 'Xcode',
        source: 'seed',
        defaultStartup: 'open ${PROJECT_XCODEPROJ}',
      },
      'com.apple.Safari': {
        name: 'Safari',
        source: 'seed',
        defaultStartup: 'open -a Safari',
      },
      'com.brave.Browser': {
        name: 'Brave',
        source: 'seed',
        defaultStartup: "open -a 'Brave Browser'",
      },
      'com.tinyspeck.slackmacgap': {
        name: 'Slack',
        source: 'seed',
        defaultStartup: 'open -a Slack',
      },
      'com.figma.Desktop': {
        name: 'Figma',
        source: 'seed',
        defaultStartup: 'open -a Figma',
      },
      'com.anthropic.claudefordesktop': {
        name: 'Claude',
        source: 'seed',
        defaultStartup: 'open -a Claude',
      },
    },
  };
}

// --- Read config ---

export async function readConfig(): Promise<Config> {
  const data = await fs.readFile(CONFIG_PATH, 'utf-8');
  return JSON.parse(data) as Config;
}

// --- Write config (atomic: temp file + rename, serialized via mutex) ---

export async function writeConfig(config: Config): Promise<void> {
  const release = await configMutex.acquire();
  try {
    // Ensure directory exists
    await fs.mkdir(CONFIG_DIR, { recursive: true });

    // Write to a temporary file in the same directory (same filesystem for atomic rename)
    const tmpPath = path.join(CONFIG_DIR, `.config.json.tmp.${process.pid}.${Date.now()}`);
    await fs.writeFile(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    // Atomic rename
    await fs.rename(tmpPath, CONFIG_PATH);
  } finally {
    release();
  }
}

// --- Ensure config exists (create with defaults if missing) ---

export async function ensureConfig(): Promise<Config> {
  try {
    await fs.access(CONFIG_PATH);
    return await readConfig();
  } catch {
    // File does not exist — create with defaults
    const config = createDefaultConfig();
    await writeConfig(config);
    return config;
  }
}
