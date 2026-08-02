// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo, customerLicenseRepo, dangoteOrderRequestRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const LICENSES = "/api/customer/licenses";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

/** Register a customer, prove the phone (→ Active), return the row + token. */
async function registerActiveCustomer(tag) {
  const phone = `+234816${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app).post(`${PORTAL_AUTH}/register`).send({ name: `Lic Cust ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, accessToken: ver.body.data.accessToken };
}

function seedLicense(customerId) {
  return customerLicenseRepo.create({
    customerId,
    companyName: "Acme Fuels Ltd",
    licenseUrl: "",
    licensePublicId: "",
    expiryDate: null,
  });
}

async function seedRequestWithLicense(customerId, licenseId, status) {
  const requestNumber = await dangoteOrderRequestRepo.generateRequestNumber();
  return dangoteOrderRequestRepo.create({
    requestNumber,
    customerId,
    licenseId,
    product: "Dangote Cement",
    quantity: 100,
    quantityUnit: "Tons",
    deliveryAddress: "1 Test Road, Lagos",
    status,
  });
}

describe("customer portal — delete a license from the register", () => {
  after(async () => {
    await closeDb();
  });

  test("a customer deletes their own unreferenced license", async () => {
    const { customer, accessToken } = await registerActiveCustomer(1);
    const license = await seedLicense(customer.id);

    const res = await request(app)
      .delete(`${LICENSES}/${license.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await customerLicenseRepo.findById(license.id), null, "license gone");
  });

  test("a foreign license is a 404, and stays put", async () => {
    const owner = await registerActiveCustomer(2);
    const intruder = await registerActiveCustomer(3);
    const license = await seedLicense(owner.customer.id);

    const res = await request(app)
      .delete(`${LICENSES}/${license.id}`)
      .set("Authorization", `Bearer ${intruder.accessToken}`)
      .send({});

    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.notEqual(await customerLicenseRepo.findById(license.id), null, "still there");
  });

  test("a license attached to a live request → 409, not deleted", async () => {
    const { customer, accessToken } = await registerActiveCustomer(4);
    const license = await seedLicense(customer.id);
    await seedRequestWithLicense(customer.id, license.id, "Approved");

    const res = await request(app)
      .delete(`${LICENSES}/${license.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.notEqual(await customerLicenseRepo.findById(license.id), null, "still there");
  });

  test("a license only on a Rejected request is still deletable", async () => {
    const { customer, accessToken } = await registerActiveCustomer(5);
    const license = await seedLicense(customer.id);
    await seedRequestWithLicense(customer.id, license.id, "Rejected");

    const res = await request(app)
      .delete(`${LICENSES}/${license.id}`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({});

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await customerLicenseRepo.findById(license.id), null, "license gone");
  });
});
