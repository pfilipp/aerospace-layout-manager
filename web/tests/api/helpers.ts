/**
 * Shared test helpers for API tests.
 *
 * Provides factories for building test Config objects and a valid
 * Origin header constant for CSRF-protected requests.
 */

import type {
  Config,
  ContainerNode,
  TreeNode,
  WindowNode,
  Workspace,
} from "../../server/types.js";

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

export function createDefaultTestConfig(): Config {
  return {
    lastGeneratedAt: null,
    modes: {},
    projects: {},
    apps: {
      "com.microsoft.VSCode": {
        name: "VS Code",
        source: "seed",
        defaultStartup: "code ${PROJECT_DIR}",
      },
      "com.googlecode.iterm2": {
        name: "iTerm2",
        source: "seed",
        defaultStartup:
          "~/nix-config/modules/darwin/scripts/iterm-window.sh '${PROJECT_ITERM_CMD}'",
      },
      "com.apple.dt.Xcode": {
        name: "Xcode",
        source: "seed",
        defaultStartup: "open ${PROJECT_XCODEPROJ}",
      },
      "com.apple.Safari": {
        name: "Safari",
        source: "seed",
        defaultStartup: "open -a Safari",
      },
      "com.brave.Browser": {
        name: "Brave",
        source: "seed",
        defaultStartup: "open -a 'Brave Browser'",
      },
      "com.tinyspeck.slackmacgap": {
        name: "Slack",
        source: "seed",
        defaultStartup: "open -a Slack",
      },
      "com.figma.Desktop": {
        name: "Figma",
        source: "seed",
        defaultStartup: "open -a Figma",
      },
      "com.anthropic.claudefordesktop": {
        name: "Claude",
        source: "seed",
        defaultStartup: "open -a Claude",
      },
    },
  };
}

export function makeWindow(
  bundleId: string,
  appName: string,
  startup: string,
  windowId = 1
): WindowNode {
  return {
    type: "window",
    "app-bundle-id": bundleId,
    "app-name": appName,
    startup,
    title: "",
    "window-id": windowId,
  };
}

export function makeContainer(
  layout: ContainerNode["layout"],
  orientation: ContainerNode["orientation"],
  children: TreeNode[]
): ContainerNode {
  return { type: "container", layout, orientation, children };
}

export function makeWorkspace(
  layout: ContainerNode,
  active = true,
  project: string | null = null
): Workspace {
  return { layout, project, active };
}

/**
 * Create a Config with a "dual" base mode containing "code", "daily",
 * and "messages" workspaces, and an "avp" derived mode inheriting
 * from "dual" with overrides and a skip.
 */
export function makeSampleConfig(): Config {
  const codeLayout = makeContainer("h_accordion", "horizontal", [
    makeWindow("com.microsoft.VSCode", "Code", "code ~/Projects/tidal", 100),
    makeWindow(
      "com.googlecode.iterm2",
      "iTerm2",
      "~/nix-config/modules/darwin/scripts/iterm-window.sh 'tmux-tidal'",
      200
    ),
  ]);

  const dailyLayout = makeContainer("h_tiles", "horizontal", [
    makeWindow("com.apple.iCal", "Calendar", "open -a Calendar", 300),
    makeContainer("v_tiles", "vertical", [
      makeWindow("com.brave.Browser", "Brave", "open -a 'Brave Browser'", 400),
      makeWindow("com.tinyspeck.slackmacgap", "Slack", "open -a Slack", 500),
    ]),
  ]);

  const messagesLayout = makeContainer("h_accordion", "horizontal", [
    makeWindow("com.apple.MobileSMS", "Messages", "open -a Messages", 600),
  ]);

  const config = createDefaultTestConfig();
  config.modes = {
    dual: {
      inherits: null,
      workspaces: {
        code: makeWorkspace(codeLayout),
        daily: makeWorkspace(dailyLayout),
        messages: makeWorkspace(messagesLayout),
      },
    },
    avp: {
      inherits: "dual",
      workspaces: {
        code: {
          layout: makeContainer("v_accordion", "vertical", [
            makeWindow(
              "com.microsoft.VSCode",
              "Code",
              "code ~/Projects/tidal",
              10
            ),
            makeWindow(
              "com.googlecode.iterm2",
              "iTerm2",
              "~/nix-config/modules/darwin/scripts/iterm-window.sh 'tmux-tidal'",
              20
            ),
          ]),
          project: "tidal",
          active: true,
        },
        messages: {
          skip: true,
        },
      },
    },
  };

  return config;
}

/** The Origin header value to use for mutating requests (CSRF) */
export const VALID_ORIGIN = "http://localhost:3847";
