/**
 * API tests for workspace CRUD endpoints.
 *
 * Tests:
 * - GET /api/modes/:mode/workspaces — resolved workspaces
 * - Metadata-only overrides inherit layout from base
 * - Workspace with skip: true excluded from resolved output
 * - PUT /api/modes/:mode/workspaces/:ws — update workspace
 * - DELETE /api/modes/:mode/workspaces/:ws — remove workspace
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

describe("Workspace CRUD — /api/modes/:mode/workspaces", () => {
  beforeEach(() => {
    mockConfig = makeSampleConfig();
  });

  // -------------------------------------------------------------------------
  // GET /api/modes/:mode/workspaces
  // -------------------------------------------------------------------------

  describe("GET /api/modes/:mode/workspaces", () => {
    it("returns resolved workspaces for a base mode", async () => {
      const res = await request(app).get("/api/modes/dual/workspaces");

      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(
        ["code", "daily", "messages"].sort()
      );
    });

    it("returns resolved workspaces for a derived mode", async () => {
      const res = await request(app).get("/api/modes/avp/workspaces");

      expect(res.status).toBe(200);
      // code overridden, daily inherited, messages skipped
      expect(Object.keys(res.body).sort()).toEqual(["code", "daily"].sort());
    });

    it("metadata-only overrides inherit layout from base", async () => {
      // Add a metadata-only override to avp for the "daily" workspace
      mockConfig.modes.avp.workspaces.daily = { active: false };

      const res = await request(app).get("/api/modes/avp/workspaces");

      expect(res.status).toBe(200);
      // daily should inherit the h_tiles layout from dual
      expect(res.body.daily.layout.layout).toBe("h_tiles");
      // but active should be overridden to false
      expect(res.body.daily.active).toBe(false);
    });

    it("workspace with skip: true excluded from resolved output", async () => {
      const res = await request(app).get("/api/modes/avp/workspaces");

      expect(res.status).toBe(200);
      // messages has skip: true in avp
      expect(res.body.messages).toBeUndefined();
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app).get("/api/modes/nope/workspaces");
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/modes/:mode/workspaces/:ws
  // -------------------------------------------------------------------------

  describe("GET /api/modes/:mode/workspaces/:ws", () => {
    it("returns a single resolved workspace", async () => {
      const res = await request(app).get("/api/modes/dual/workspaces/code");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("code");
      expect(res.body.layout).toBeDefined();
      expect(res.body.layout.layout).toBe("h_accordion");
    });

    it("returns 404 for nonexistent workspace", async () => {
      const res = await request(app).get(
        "/api/modes/dual/workspaces/nonexistent"
      );
      expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app).get(
        "/api/modes/nope/workspaces/code"
      );
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // PUT /api/modes/:mode/workspaces/:ws
  // -------------------------------------------------------------------------

  describe("PUT /api/modes/:mode/workspaces/:ws", () => {
    it("updates a workspace", async () => {
      const newLayout = makeContainer("v_tiles", "vertical", [
        makeWindow("com.apple.Safari", "Safari", "open -a Safari", 1),
      ]);
      const newWs = makeWorkspace(newLayout, false);

      const res = await request(app)
        .put("/api/modes/dual/workspaces/code")
        .set("Origin", VALID_ORIGIN)
        .send(newWs);

      expect(res.status).toBe(200);

      // Verify persisted
      const stored = mockConfig.modes.dual.workspaces.code as Workspace;
      expect(stored.layout.layout).toBe("v_tiles");
      expect(stored.active).toBe(false);
    });

    it("creates a new workspace if it does not exist", async () => {
      const layout = makeContainer("h_tiles", "horizontal", [
        makeWindow("com.apple.Safari", "Safari", "open -a Safari", 1),
      ]);

      const res = await request(app)
        .put("/api/modes/dual/workspaces/newws")
        .set("Origin", VALID_ORIGIN)
        .send(makeWorkspace(layout));

      expect(res.status).toBe(200);
      expect(mockConfig.modes.dual.workspaces.newws).toBeDefined();
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app)
        .put("/api/modes/nope/workspaces/code")
        .set("Origin", VALID_ORIGIN)
        .send({ layout: {}, active: true, project: null });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/modes/:mode/workspaces/:ws
  // -------------------------------------------------------------------------

  describe("DELETE /api/modes/:mode/workspaces/:ws", () => {
    it("removes a workspace from a mode", async () => {
      const res = await request(app)
        .delete("/api/modes/dual/workspaces/messages")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(204);
      expect(mockConfig.modes.dual.workspaces.messages).toBeUndefined();
    });

    it("returns 404 for nonexistent workspace", async () => {
      const res = await request(app)
        .delete("/api/modes/dual/workspaces/nonexistent")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(404);
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app)
        .delete("/api/modes/nope/workspaces/code")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(404);
    });
  });
});
