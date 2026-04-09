/**
 * API tests for app registry endpoints.
 *
 * Note: The apps router is not yet mounted in server/index.ts,
 * so we build a minimal Express app with the apps routes directly.
 *
 * Tests:
 * - GET /api/apps — returns app registry
 * - POST /api/apps/discover — returns 503 when aerospace not running
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";
import type { Config } from "../../server/types.js";
import { createDefaultTestConfig, VALID_ORIGIN } from "./helpers.js";

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

// Mock the discover service to simulate aerospace not running
vi.mock("../../server/services/discover.js", () => ({
  discoverApps: vi.fn(async () => {
    throw new Error("AeroSpace must be running for app discovery to work");
  }),
}));

const { default: request } = await import("supertest");

// Build a small Express app with CSRF + apps router
const { csrfProtection } = await import("../../server/middleware/csrf.js");
const { default: appsRouter } = await import("../../server/routes/apps.js");

const testApp = express();
testApp.use(express.json());
testApp.use(csrfProtection);
testApp.use("/api/apps", appsRouter);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("App registry — /api/apps", () => {
  beforeEach(() => {
    mockConfig = createDefaultTestConfig();
  });

  // -------------------------------------------------------------------------
  // GET /api/apps
  // -------------------------------------------------------------------------

  describe("GET /api/apps", () => {
    it("returns app registry with seeded apps", async () => {
      const res = await request(testApp).get("/api/apps");

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("com.microsoft.VSCode");
      expect(res.body).toHaveProperty("com.googlecode.iterm2");
      expect(res.body).toHaveProperty("com.apple.dt.Xcode");
      expect(res.body).toHaveProperty("com.apple.Safari");
      expect(res.body).toHaveProperty("com.brave.Browser");
      expect(res.body).toHaveProperty("com.tinyspeck.slackmacgap");
      expect(res.body).toHaveProperty("com.figma.Desktop");
      expect(res.body).toHaveProperty("com.anthropic.claudefordesktop");

      // Verify structure of a single entry
      const vscode = res.body["com.microsoft.VSCode"];
      expect(vscode.name).toBe("VS Code");
      expect(vscode.source).toBe("seed");
      expect(vscode.defaultStartup).toBe("code ${PROJECT_DIR}");
    });

    it("returns 8 seeded apps", async () => {
      const res = await request(testApp).get("/api/apps");

      expect(res.status).toBe(200);
      expect(Object.keys(res.body)).toHaveLength(8);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/apps/discover
  // -------------------------------------------------------------------------

  describe("POST /api/apps/discover", () => {
    it("returns 503 when aerospace is not running", async () => {
      const res = await request(testApp)
        .post("/api/apps/discover")
        .set("Origin", VALID_ORIGIN);

      expect(res.status).toBe(503);
      expect(res.body.error).toContain("AeroSpace must be running");
    });
  });
});
