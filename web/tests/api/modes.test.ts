/**
 * API tests for mode and workspace CRUD endpoints.
 *
 * Tests:
 * - GET /api/modes — list modes
 * - POST /api/modes — create mode (with inheritance validation)
 * - GET /api/modes/:mode — resolved mode with inheritance
 * - PUT /api/modes/:mode — update mode
 * - DELETE /api/modes/:mode — delete (409 if dependents)
 * - GET /api/modes/:nonexistent — 404
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Config } from "../../server/types.js";
import {
  createDefaultTestConfig,
  makeSampleConfig,
  VALID_ORIGIN,
} from "./helpers.js";

// ---------------------------------------------------------------------------
// Mock the config service so routes use our in-memory config
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

// Import app AFTER mocking
const { default: request } = await import("supertest");
const { default: app } = await import("../../server/index.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Mode CRUD — /api/modes", () => {
  beforeEach(() => {
    mockConfig = makeSampleConfig();
  });

  // -------------------------------------------------------------------------
  // GET /api/modes
  // -------------------------------------------------------------------------

  describe("GET /api/modes", () => {
    it("returns list of modes with workspace counts", async () => {
      const res = await request(app).get("/api/modes");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("dual");
      expect(res.body).toHaveProperty("avp");
      expect(res.body.dual.inherits).toBeNull();
      expect(res.body.dual.workspaceCount).toBe(3);
      expect(res.body.avp.inherits).toBe("dual");
      // avp: code overridden, daily inherited, messages skipped = 2
      expect(res.body.avp.workspaceCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/modes
  // -------------------------------------------------------------------------

  describe("POST /api/modes", () => {
    it("creates a new base mode", async () => {
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "custom" });

      expect(res.status).toBe(201);
      expect(res.body.inherits).toBeNull();
      expect(res.body.workspaces).toEqual({});

      // Verify it persisted
      expect(mockConfig.modes.custom).toBeDefined();
    });

    it("creates a derived mode with valid inherits", async () => {
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "custom-avp", inherits: "dual" });

      expect(res.status).toBe(201);
      expect(res.body.inherits).toBe("dual");
    });

    it("validates that inherits target has inherits: null", async () => {
      // Try to inherit from "avp" which inherits from "dual"
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "bad-mode", inherits: "avp" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("single-level inheritance");
    });

    it("rejects inheriting from a derived mode", async () => {
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "nested", inherits: "avp" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already inherits");
    });

    it("rejects missing name", async () => {
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("name");
    });

    it("rejects duplicate mode name", async () => {
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "dual" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("already exists");
    });

    it("rejects inheriting from nonexistent mode", async () => {
      const res = await request(app)
        .post("/api/modes")
        .set("Origin", VALID_ORIGIN)
        .send({ name: "orphan", inherits: "doesnotexist" });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("does not exist");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/modes/:mode
  // -------------------------------------------------------------------------

  describe("GET /api/modes/:mode", () => {
    it("returns resolved base mode with all workspaces", async () => {
      const res = await request(app).get("/api/modes/dual");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("dual");
      expect(res.body.inherits).toBeNull();
      expect(Object.keys(res.body.workspaces)).toHaveLength(3);
      expect(res.body.workspaces.code).toBeDefined();
      expect(res.body.workspaces.daily).toBeDefined();
      expect(res.body.workspaces.messages).toBeDefined();
    });

    it("returns resolved derived mode with inheritance merged", async () => {
      const res = await request(app).get("/api/modes/avp");

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("avp");
      expect(res.body.inherits).toBe("dual");
      // code overridden, daily inherited, messages skipped
      expect(Object.keys(res.body.workspaces).sort()).toEqual(
        ["code", "daily"].sort()
      );
      // code should have avp-specific layout
      expect(res.body.workspaces.code.layout.layout).toBe("v_accordion");
      // daily should be inherited from dual
      expect(res.body.workspaces.daily.layout.layout).toBe("h_tiles");
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app).get("/api/modes/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });
  });

  // -------------------------------------------------------------------------
  // PUT /api/modes/:mode
  // -------------------------------------------------------------------------

  describe("PUT /api/modes/:mode", () => {
    it("updates a mode", async () => {
      const res = await request(app)
        .put("/api/modes/dual")
        .set("Origin", VALID_ORIGIN)
        .send({ workspaces: {} });

      expect(res.status).toBe(200);
      expect(mockConfig.modes.dual.workspaces).toEqual({});
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app)
        .put("/api/modes/nope")
        .set("Origin", VALID_ORIGIN)
        .send({ workspaces: {} });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/modes/:mode
  // -------------------------------------------------------------------------

  describe("DELETE /api/modes/:mode", () => {
    it("deletes a mode with no dependents", async () => {
      const res = await request(app)
        .delete("/api/modes/avp")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(204);
      expect(mockConfig.modes.avp).toBeUndefined();
    });

    it("returns 409 if dependents exist", async () => {
      // Try to delete "dual" which "avp" inherits from
      const res = await request(app)
        .delete("/api/modes/dual")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(409);
      expect(res.body.error).toContain("avp");
    });

    it("returns 404 for nonexistent mode", async () => {
      const res = await request(app)
        .delete("/api/modes/nope")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(404);
    });
  });
});
