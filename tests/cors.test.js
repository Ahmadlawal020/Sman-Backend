require("dotenv").config();

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const express = require("express");
const cors = require("cors");
const corsOptions = require("../config/corsOptions");
const { mobileCorsBypass } = require("../config/corsOptions");

describe("CORS configuration", () => {
  const createTestApp = () => {
    const app = express();
    app.use(mobileCorsBypass);
    const corsMiddleware = cors(corsOptions);
    app.use((req, res, next) => {
      if (req._mobileCorsBypassed) return next();
      corsMiddleware(req, res, next);
    });
    app.get("/api/test-cors", (req, res) => {
      res.json({ success: true, message: "CORS test endpoint" });
    });
    app.post("/api/test-cors", (req, res) => {
      res.json({ success: true, message: "CORS post test" });
    });
    // Error handler for CORS errors
    app.use((err, req, res, next) => {
      const status = err.status || err.statusCode || 500;
      res.status(status).json({ success: false, message: err.message });
    });
    return app;
  };

  test("allows requests from standard allowed dev origins (e.g. http://localhost:3000)", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/test-cors")
      .set("Origin", "http://localhost:3000");

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3000");
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  test("allows requests from Vite default port (http://localhost:5173)", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/test-cors")
      .set("Origin", "http://localhost:5173");

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:5173");
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  test("handles preflight OPTIONS request with correct headers", async () => {
    const app = createTestApp();
    const res = await request(app)
      .options("/api/test-cors")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "Content-Type, X-CSRF-Token");

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:3000");
    assert.equal(res.headers["access-control-allow-credentials"], "true");
    assert.ok(res.headers["access-control-allow-methods"].includes("POST"));
    assert.ok(res.headers["access-control-allow-headers"].includes("Content-Type"));
  });

  test("allows non-origin requests (e.g. Postman, cURL) when CORS_ALLOW_NO_ORIGIN is not false", async () => {
    const original = process.env.CORS_ALLOW_NO_ORIGIN;
    try {
      delete process.env.CORS_ALLOW_NO_ORIGIN;
      const app = createTestApp();
      const res = await request(app).get("/api/test-cors");

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    } finally {
      if (original !== undefined) process.env.CORS_ALLOW_NO_ORIGIN = original;
    }
  });

  test("blocks requests from disallowed origins with 403 Forbidden", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/test-cors")
      .set("Origin", "https://unauthorized-evil-site.com");

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.equal(res.body.message, "Not allowed by CORS");
  });

  test("correctly normalizes trailing slashes on origins", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/test-cors")
      .set("Origin", "http://localhost:3000/");

    assert.equal(res.status, 200);
  });

  test("enforces strict configured origins in production environment", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalAllowed = process.env.CORS_ALLOWED_ORIGINS;
    try {
      process.env.NODE_ENV = "production";
      process.env.CORS_ALLOWED_ORIGINS = "https://soroman-frontend.up.railway.app/";

      const app = createTestApp();

      // Allowed prod origin (even if header has or env had trailing slash)
      const res1 = await request(app)
        .get("/api/test-cors")
        .set("Origin", "https://soroman-frontend.up.railway.app");
      assert.equal(res1.status, 200);

      // Unconfigured random localhost port in prod should be blocked
      const res2 = await request(app)
        .get("/api/test-cors")
        .set("Origin", "http://localhost:9999");
      assert.equal(res2.status, 403);
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.env.CORS_ALLOWED_ORIGINS = originalAllowed;
    }
  });

  test("handles preflight OPTIONS request for mobile headers (X-Auth-Transport, X-Api-Key)", async () => {
    const app = createTestApp();
    const res = await request(app)
      .options("/api/test-cors")
      .set("Origin", "http://localhost:8081")
      .set("Access-Control-Request-Method", "GET")
      .set("Access-Control-Request-Headers", "Content-Type, X-Auth-Transport, X-Api-Key, Authorization");

    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], "http://localhost:8081");
    assert.ok(res.headers["access-control-allow-headers"].includes("X-Auth-Transport"));
    assert.ok(res.headers["access-control-allow-headers"].includes("X-Api-Key"));
  });

  // ── Mobile bypass middleware tests ──────────────────────────────────────

  test("mobileCorsBypass allows mobile GET with X-Auth-Transport: body (no Origin)", async () => {
    const original = process.env.CORS_ALLOW_NO_ORIGIN;
    try {
      process.env.CORS_ALLOW_NO_ORIGIN = "false"; // would normally block
      const app = createTestApp();
      const res = await request(app)
        .get("/api/test-cors")
        .set("X-Auth-Transport", "body");

      assert.equal(res.status, 200);
      assert.equal(res.headers["access-control-allow-origin"], "*");
      assert.equal(res.body.success, true);
    } finally {
      if (original !== undefined) {
        process.env.CORS_ALLOW_NO_ORIGIN = original;
      } else {
        delete process.env.CORS_ALLOW_NO_ORIGIN;
      }
    }
  });

  test("mobileCorsBypass allows mobile GET with X-Api-Key (no Origin)", async () => {
    const original = process.env.CORS_ALLOW_NO_ORIGIN;
    try {
      process.env.CORS_ALLOW_NO_ORIGIN = "false";
      const app = createTestApp();
      const res = await request(app)
        .get("/api/test-cors")
        .set("X-Api-Key", "test-key-123");

      assert.equal(res.status, 200);
      assert.equal(res.headers["access-control-allow-origin"], "*");
      assert.equal(res.body.success, true);
    } finally {
      if (original !== undefined) {
        process.env.CORS_ALLOW_NO_ORIGIN = original;
      } else {
        delete process.env.CORS_ALLOW_NO_ORIGIN;
      }
    }
  });

  test("mobileCorsBypass short-circuits OPTIONS preflight for mobile requests", async () => {
    const original = process.env.CORS_ALLOW_NO_ORIGIN;
    try {
      process.env.CORS_ALLOW_NO_ORIGIN = "false";
      const app = createTestApp();
      const res = await request(app)
        .options("/api/test-cors")
        .set("X-Auth-Transport", "body");

      assert.equal(res.status, 200);
      assert.equal(res.headers["access-control-allow-origin"], "*");
      assert.ok(res.headers["access-control-allow-methods"].includes("POST"));
    } finally {
      if (original !== undefined) {
        process.env.CORS_ALLOW_NO_ORIGIN = original;
      } else {
        delete process.env.CORS_ALLOW_NO_ORIGIN;
      }
    }
  });

  test("mobileCorsBypass does NOT bypass for browser requests (Origin header present)", async () => {
    const app = createTestApp();
    const res = await request(app)
      .get("/api/test-cors")
      .set("Origin", "https://unauthorized-evil-site.com")
      .set("X-Auth-Transport", "body"); // attacker tries to add mobile header

    // cors() should still reject the disallowed origin
    assert.equal(res.status, 403);
    assert.equal(res.body.message, "Not allowed by CORS");
  });

  test("mobileCorsBypass does NOT bypass for anonymous no-origin requests without mobile headers", async () => {
    const original = process.env.CORS_ALLOW_NO_ORIGIN;
    try {
      process.env.CORS_ALLOW_NO_ORIGIN = "false";
      const app = createTestApp();
      const res = await request(app).get("/api/test-cors");

      // Should be blocked by cors() since CORS_ALLOW_NO_ORIGIN=false and no mobile headers
      assert.equal(res.status, 403);
    } finally {
      if (original !== undefined) {
        process.env.CORS_ALLOW_NO_ORIGIN = original;
      } else {
        delete process.env.CORS_ALLOW_NO_ORIGIN;
      }
    }
  });
});
