// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { closeDb } = require("./helpers");

/**
 * GET /app — the device-aware store redirect behind the WhatsApp
 * "Download mobile app" button. Pure env + User-Agent → 302; no DB.
 */

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const IOS_URL = "https://apps.apple.com/app/id0000000000";
const ANDROID_URL = "https://play.google.com/store/apps/details?id=com.soroman.app";
const SITE_URL = "https://soroman.example";

describe("GET /app — store redirect", () => {
  beforeEach(() => {
    process.env.APP_STORE_IOS_URL = IOS_URL;
    process.env.APP_STORE_ANDROID_URL = ANDROID_URL;
    process.env.SOROMAN_WEBSITE_URL = SITE_URL;
  });

  after(async () => {
    delete process.env.APP_STORE_IOS_URL;
    delete process.env.APP_STORE_ANDROID_URL;
    delete process.env.SOROMAN_WEBSITE_URL;
    await closeDb();
  });

  test("iPhone lands on the App Store", async () => {
    const res = await request(app).get("/app").set("User-Agent", IOS_UA);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, IOS_URL);
  });

  test("iPad presenting as Macintosh+Mobile lands on the App Store", async () => {
    const res = await request(app).get("/app").set("User-Agent", IPAD_DESKTOP_UA);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, IOS_URL);
  });

  test("Android lands on the Play Store", async () => {
    const res = await request(app).get("/app").set("User-Agent", ANDROID_UA);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, ANDROID_URL);
  });

  test("desktop (unknown device) falls back to the website", async () => {
    const res = await request(app).get("/app").set("User-Agent", DESKTOP_UA);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, SITE_URL);
  });

  test("a missing store URL falls back rather than dead-ends", async () => {
    delete process.env.APP_STORE_IOS_URL;
    const res = await request(app).get("/app").set("User-Agent", IOS_UA);
    assert.equal(res.status, 302);
    assert.equal(res.headers.location, SITE_URL);
  });

  test("nothing configured at all is an honest 404", async () => {
    delete process.env.APP_STORE_IOS_URL;
    delete process.env.APP_STORE_ANDROID_URL;
    delete process.env.SOROMAN_WEBSITE_URL;
    const prevClient = process.env.CLIENT_URL;
    delete process.env.CLIENT_URL;
    try {
      const res = await request(app).get("/app").set("User-Agent", DESKTOP_UA);
      assert.equal(res.status, 404);
    } finally {
      if (prevClient !== undefined) process.env.CLIENT_URL = prevClient;
    }
  });
});
