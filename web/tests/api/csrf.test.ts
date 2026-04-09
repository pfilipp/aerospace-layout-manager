/**
 * API tests for CSRF (Origin header) validation.
 *
 * Tests:
 * - POST without Origin header returns 403
 * - POST with wrong Origin returns 403
 * - POST with http://localhost:3847 passes
 * - POST with http://127.0.0.1:3847 passes
 * - GET requests pass without Origin
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Config } from "../../server/types.js";
import { createDefaultTestConfig } from "./helpers.js";

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

describe("CSRF protection — Origin header validation", () => {
  beforeEach(() => {
    mockConfig = createDefaultTestConfig();
  });

  it("POST without Origin header returns 403", async () => {
    const res = await request(app)
      .post("/api/modes")
      .send({ name: "test" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Origin");
  });

  it("POST with wrong Origin returns 403", async () => {
    const res = await request(app)
      .post("/api/modes")
      .set("Origin", "http://evil.example.com")
      .send({ name: "test" });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Origin");
  });

  it("POST with http://localhost:3847 Origin passes CSRF", async () => {
    const res = await request(app)
      .post("/api/modes")
      .set("Origin", "http://localhost:3847")
      .send({ name: "newmode" });

    // Should not be 403 (it may be 201 on success or 400/etc, but not 403)
    expect(res.status).not.toBe(403);
  });

  it("POST with http://127.0.0.1:3847 Origin passes CSRF", async () => {
    const res = await request(app)
      .post("/api/modes")
      .set("Origin", "http://127.0.0.1:3847")
      .send({ name: "newmode2" });

    expect(res.status).not.toBe(403);
  });

  it("PUT without Origin header returns 403", async () => {
    const res = await request(app)
      .put("/api/projects/test")
      .send({ name: "test", dir: "~/test", apps: [] });

    expect(res.status).toBe(403);
  });

  it("DELETE without Origin header returns 403", async () => {
    const res = await request(app).delete("/api/projects/test");

    expect(res.status).toBe(403);
  });

  it("GET requests pass without Origin header", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("GET /api/modes passes without Origin header", async () => {
    const res = await request(app).get("/api/modes");

    expect(res.status).toBe(200);
  });

  it("POST with wrong port in Origin returns 403", async () => {
    const res = await request(app)
      .post("/api/modes")
      .set("Origin", "http://localhost:8080")
      .send({ name: "test" });

    expect(res.status).toBe(403);
  });

  it("POST with https scheme returns 403", async () => {
    const res = await request(app)
      .post("/api/modes")
      .set("Origin", "https://localhost:3847")
      .send({ name: "test" });

    expect(res.status).toBe(403);
  });
});
