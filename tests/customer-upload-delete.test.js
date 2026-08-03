// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const UPLOADS = "/api/customer/uploads";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

// The controller reads these at request time, so the tests set them to exercise
// each branch and restore the originals afterwards. CI has no Cloudinary config.
const ORIG_SECRET = process.env.CLOUDINARY_API_SECRET;
const ORIG_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const configureCloudinary = () => {
  process.env.CLOUDINARY_API_SECRET = "test-secret";
  process.env.CLOUDINARY_CLOUD_NAME = "test-cloud";
};
const unconfigureCloudinary = () => {
  delete process.env.CLOUDINARY_API_SECRET;
  delete process.env.CLOUDINARY_CLOUD_NAME;
};
const restoreCloudinary = () => {
  if (ORIG_SECRET === undefined) delete process.env.CLOUDINARY_API_SECRET;
  else process.env.CLOUDINARY_API_SECRET = ORIG_SECRET;
  if (ORIG_CLOUD === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
  else process.env.CLOUDINARY_CLOUD_NAME = ORIG_CLOUD;
};

async function registerActiveCustomer(tag) {
  const phone = `+234817${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Up Cust ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, accessToken: ver.body.data.accessToken };
}

describe("customer portal — delete an uploaded document", () => {
  after(async () => {
    restoreCloudinary();
    await closeDb();
  });

  test("deleting requires authentication", async () => {
    const res = await request(app).post(`${UPLOADS}/delete`).send({ publicId: "soroman/licenses/x" });
    assert.equal(res.status, 401, JSON.stringify(res.body));
  });

  test("a missing publicId is rejected at the edge (400)", async () => {
    const { accessToken } = await registerActiveCustomer(1);
    const res = await request(app)
      .post(`${UPLOADS}/delete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});
    assert.equal(res.status, 400, JSON.stringify(res.body));
  });

  test("a publicId outside the customer upload folder is refused 403", async () => {
    configureCloudinary();
    const { accessToken } = await registerActiveCustomer(2);
    const res = await request(app)
      .post(`${UPLOADS}/delete`)
      .set("Authorization", `Bearer ${accessToken}`)
      // A staff/other-folder asset — the guard must refuse before any Cloudinary call.
      .send({ publicId: "soroman/staff-secret/passport-123" });
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test("when uploads are not configured, delete is unavailable (503)", async () => {
    unconfigureCloudinary();
    const { accessToken } = await registerActiveCustomer(3);
    const res = await request(app)
      .post(`${UPLOADS}/delete`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ publicId: "soroman/licenses/doc-123" });
    assert.equal(res.status, 503, JSON.stringify(res.body));
  });
});
