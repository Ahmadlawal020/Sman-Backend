require("dotenv").config();

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const express = require("express");
const cors = require("cors");
const corsOptions = require("../config/corsOptions");

describe("CORS configuration", () => {
  const createTestApp = () => {
    const app = express();
    app.use(cors(corsOptions));
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

  test("allows non-origin requests (e.g. Postman, cURL, mobile apps)", async () => {
    const app = createTestApp();
    const res = await request(app).get("/api/test-cors");

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.headers["access-control-allow-origin"], undefined);
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
});

