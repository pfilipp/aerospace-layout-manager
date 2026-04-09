/**
 * API tests for project CRUD and apply-project endpoints.
 *
 * Tests:
 * - GET /api/projects — list projects
 * - PUT /api/projects/:name — create/update project (400 for missing fields)
 * - DELETE /api/projects/:name — delete (404 if missing)
 * - POST /api/modes/:mode/workspaces/:ws/apply-project — apply project preset
 * - Variable substitution (${PROJECT_*})
 * - Empty subdir handling (no trailing slash)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Config, Workspace } from "../../server/types.js";
import {
  createDefaultTestConfig,
  makeContainer,
  makeSampleConfig,
  makeWindow,
  makeWorkspace,
  VALID_ORIGIN,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Mock config service
// ---------------------------------------------------------------------------

let mockConfig: Config;

vi.mock("../../server/services/config.js", () => ({
  readConfig: vi.fn(async () => JSON.parse(JSON.stringify(mockConfig))),
  writeConfig: vi.fn(async (c: Config) => {
    mockConfig = JSON.parse(JSON.stringify(c));
  }),
  ensureConfig: vi.fn(async () => JSON.parse(JSON.stringify(mockConfig))),
  createDefaultConfig: vi.fn(() => createDefaultTestConfig()),
  CONFIG_PATH: "/tmp/test-config.json",
  CONFIG_DIR: "/tmp",
}));

const { default: request } = await import("supertest");
const { default: app } = await import("../../server/index.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Project CRUD — /api/projects", () => {
  beforeEach(() => {
    mockConfig = makeSampleConfig();
    // Add a sample project
    mockConfig.projects.tidal = {
      name: "tidal",
      dir: "~/Projects/tlg/tidal",
      subdir: "",
      iterm_cmd: "tmux-tidal",
      xcodeproj: "",
      apps: ["com.microsoft.VSCode", "com.googlecode.iterm2"],
    };
  });

  // -------------------------------------------------------------------------
  // GET /api/projects
  // -------------------------------------------------------------------------

  describe("GET /api/projects", () => {
    it("returns list of projects", async () => {
      const res = await request(app).get("/api/projects");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("tidal");
      expect(res.body.tidal.name).toBe("tidal");
      expect(res.body.tidal.dir).toBe("~/Projects/tlg/tidal");
    });

    it("returns empty object when no projects exist", async () => {
      mockConfig.projects = {};
      const res = await request(app).get("/api/projects");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // PUT /api/projects/:name
  // -------------------------------------------------------------------------

  describe("PUT /api/projects/:name", () => {
    it("creates a new project", async () => {
      const res = await request(app)
        .put("/api/projects/newproj")
        .set("Origin", VALID_ORIGIN)
        .send({
          name: "newproj",
          dir: "~/Projects/new",
          apps: ["com.microsoft.VSCode"],
        });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("newproj");
      expect(res.body.dir).toBe("~/Projects/new");
      expect(res.body.subdir).toBe("");
      expect(res.body.iterm_cmd).toBe("");
      expect(mockConfig.projects.newproj).toBeDefined();
    });

    it("returns 400 for missing required name", async () => {
      const res = await request(app)
        .put("/api/projects/test")
        .set("Origin", VALID_ORIGIN)
        .send({ dir: "~/test", apps: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("name");
    });

    it("returns 400 for missing required dir", async () => {
      const res = await request(app)
        .put("/api/projects/test")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "test", apps: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("dir");
    });

    it("returns 400 for missing required apps array", async () => {
      const res = await request(app)
        .put("/api/projects/test")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "test", dir: "~/test" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("apps");
    });

    it("returns 400 when URL name does not match body name", async () => {
      const res = await request(app)
        .put("/api/projects/foo")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "bar", dir: "~/test", apps: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("does not match");
    });

    it("updates an existing project", async () => {
      const res = await request(app)
        .put("/api/projects/tidal")
        .set("Origin", VALID_ORIGIN)
        .send({
          name: "tidal",
          dir: "~/Projects/tlg/tidal-v2",
          apps: ["com.microsoft.VSCode"],
          iterm_cmd: "tmux-tidal-v2",
        });

      expect(res.status).toBe(200);
      expect(res.body.dir).toBe("~/Projects/tlg/tidal-v2");
      expect(mockConfig.projects.tidal.dir).toBe("~/Projects/tlg/tidal-v2");
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/projects/:name
  // -------------------------------------------------------------------------

  describe("DELETE /api/projects/:name", () => {
    it("deletes an existing project", async () => {
      const res = await request(app)
        .delete("/api/projects/tidal")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe("tidal");
      expect(mockConfig.projects.tidal).toBeUndefined();
    });

    it("returns 404 for nonexistent project", async () => {
      const res = await request(app)
        .delete("/api/projects/nonexistent")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });
});

// ---------------------------------------------------------------------------
// Apply project
// ---------------------------------------------------------------------------

describe("Apply project — POST /api/modes/:mode/workspaces/:ws/apply-project", () => {
  beforeEach(() => {
    mockConfig = makeSampleConfig();
    // Add project and apps
    mockConfig.projects.tidal = {
      name: "tidal",
      dir: "~/Projects/tlg/tidal",
      subdir: "frontend",
      iterm_cmd: "tmux-tidal",
      xcodeproj: "",
      apps: ["com.microsoft.VSCode", "com.googlecode.iterm2"],
    };
  });

  it("returns preview when confirm is not set", async () => {
    const res = await request(app)
      .post("/api/modes/dual/workspaces/code/apply-project")
      .set("Origin", VALID_ORIGIN)
      .send({ project: "tidal" });

    expect(res.status).toBe(200);
    expect(res.body.preview).toBe(true);
    expect(res.body.changes).toBeInstanceOf(Array);
    expect(res.body.changes.length).toBeGreaterThan(0);

    // Each change should have old and new startup
    for (const change of res.body.changes) {
      expect(change).toHaveProperty("oldStartup");
      expect(change).toHaveProperty("newStartup");
      expect(change).toHaveProperty("app-bundle-id");
    }
  });

  it("applies project and substitutes ${PROJECT_*} variables correctly", async () => {
    const res = await request(app)
      .post("/api/modes/dual/workspaces/code/apply-project?confirm=true")
      .set("Origin", VALID_ORIGIN)
      .send({ project: "tidal" });

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);

    // Check that VSCode startup was substituted
    const vscodeChange = res.body.changes.find(
      (c: { "app-bundle-id": string }) =>
        c["app-bundle-id"] === "com.microsoft.VSCode"
    );
    expect(vscodeChange).toBeDefined();
    // defaultStartup for VSCode is "code ${PROJECT_DIR}"
    // With subdir "frontend": PROJECT_DIR = ~/Projects/tlg/tidal
    expect(vscodeChange.newStartup).toBe("code ~/Projects/tlg/tidal");

    // Check iTerm2 startup
    const itermChange = res.body.changes.find(
      (c: { "app-bundle-id": string }) =>
        c["app-bundle-id"] === "com.googlecode.iterm2"
    );
    expect(itermChange).toBeDefined();
    expect(itermChange.newStartup).toContain("tmux-tidal");

    // Verify the workspace project field was set
    const ws = mockConfig.modes.dual.workspaces.code as Workspace;
    expect(ws.project).toBe("tidal");
  });

  it("handles empty subdir without trailing slash", async () => {
    // Set subdir to empty
    mockConfig.projects.tidal.subdir = "";

    // Need an app with defaultStartup containing ${PROJECT_DIR}/${PROJECT_SUBDIR}
    mockConfig.apps["com.microsoft.VSCode"].defaultStartup =
      "code ${PROJECT_DIR}/${PROJECT_SUBDIR}";

    const res = await request(app)
      .post("/api/modes/dual/workspaces/code/apply-project?confirm=true")
      .set("Origin", VALID_ORIGIN)
      .send({ project: "tidal" });

    expect(res.status).toBe(200);

    const vscodeChange = res.body.changes.find(
      (c: { "app-bundle-id": string }) =>
        c["app-bundle-id"] === "com.microsoft.VSCode"
    );
    // Should be "code ~/Projects/tlg/tidal" without trailing slash
    expect(vscodeChange.newStartup).toBe("code ~/Projects/tlg/tidal");
    expect(vscodeChange.newStartup).not.toContain("//");
    expect(vscodeChange.newStartup).not.toMatch(/\/$/);
  });

  it("returns 404 for nonexistent project", async () => {
    const res = await request(app)
      .post("/api/modes/dual/workspaces/code/apply-project")
      .set("Origin", VALID_ORIGIN)
      .send({ project: "nonexistent" });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("not found");
  });

  it("returns 404 for nonexistent mode", async () => {
    const res = await request(app)
      .post("/api/modes/nope/workspaces/code/apply-project")
      .set("Origin", VALID_ORIGIN)
      .send({ project: "tidal" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for missing project field", async () => {
    const res = await request(app)
      .post("/api/modes/dual/workspaces/code/apply-project")
      .set("Origin", VALID_ORIGIN)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("project");
  });
});
