// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { customerRepo } = require("../repositories");
const { NATIVE_TRANSPORT, staffToken, closeDb } = require("./helpers");

const PORTAL_AUTH = "/api/customer/auth";
const DD = "/api/customer/dangote-delivery-orders";
const STAFF = "/api/dangote-delivery-orders";
const LICENSES = "/api/customer/licenses";
const STAFF_LICENSES = "/api/customer-licenses";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

const pdf = () => Buffer.from("%PDF-1.7\ntest license body");

const auth = (token) => ({ Authorization: `Bearer ${token}`, ...NATIVE_TRANSPORT });

const DETAILS = {
  product: "AGO",
  quantity: 10000,
  deliveryAddress: "3 Depot Close, Ibadan",
  deliveryState: "Oyo",
  contactPerson: "Bola Ade",
  contactPhone: "+2348022233344",
};

async function registerActiveCustomer(tag) {
  const phone = `+234815${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app)
    .post(`${PORTAL_AUTH}/register`)
    .send({ name: `Staff Flow Cust ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  // Pre-seed the DVA so approval never reaches the real payment provider.
  await customerRepo.update(customer.id, {
    virtualAccountNumber: `VA${tag}${String(RUN).slice(-6)}`,
    virtualAccountBank: "Test Bank",
    virtualAccountName: `SOROMANNIGERI/ SF${tag}`,
  });
  return { customer, token: ver.body.data.accessToken };
}

/** Walk a customer order to UNDER_REVIEW via the portal API. */
const COMPANY = `Staff Flow Co ${RUN}`;

// Create a customer license (backend-upload mode) for the shared company.
async function createLicense(customer) {
  const res = await request(app)
    .post(LICENSES)
    .set(auth(customer.token))
    .field("companyName", COMPANY)
    .attach("file", pdf(), { filename: "license.pdf", contentType: "application/pdf" });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.license.id;
}

// Walk an order to UNDER_REVIEW: details → company → link license → submit
// documents → sign → submit.
async function submittedOrder(customer, licenseId) {
  const created = await request(app).post(DD).set(auth(customer.token)).send(DETAILS);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.data.order.id;
  await request(app).put(`${DD}/${id}/company`).set(auth(customer.token)).send({ companyName: COMPANY });
  const link = await request(app).post(`${DD}/${id}/license`).set(auth(customer.token)).send({ licenseId });
  assert.equal(link.status, 200, JSON.stringify(link.body));
  const sd = await request(app).post(`${DD}/${id}/documents/submit`).set(auth(customer.token));
  assert.equal(sd.status, 200, JSON.stringify(sd.body));
  await request(app).post(`${DD}/${id}/agreement`).set(auth(customer.token)).send({ fullName: "Bola Ade" });
  const sub = await request(app).post(`${DD}/${id}/submit`).set(auth(customer.token));
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  assert.equal(sub.body.data.order.status, "UNDER_REVIEW");
  return { id };
}

describe("dangote delivery — staff quote desk", () => {
  let token;
  let me;

  before(async () => {
    token = await staffToken(request, app);
    me = await registerActiveCustomer(1);
  });

  after(async () => {
    await closeDb();
  });

  test("full desk flow: verify → quote → paid → fulfilment", async () => {
    const licenseId = await createLicense(me);
    const { id } = await submittedOrder(me, licenseId);

    // Listed for the desk
    const list = await request(app)
      .get(STAFF)
      .query({ status: "UNDER_REVIEW" })
      .set(auth(token));
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.ok(list.body.data.requests.some((r) => r.id === id));

    // Approval is blocked until the linked license is verified
    const early = await request(app)
      .post(`${STAFF}/${id}/approve`)
      .set(auth(token))
      .send({ unitPrice: 900 });
    assert.equal(early.status, 409, JSON.stringify(early.body));

    // License verification requires the printed expiry date
    const noExpiry = await request(app)
      .post(`${STAFF_LICENSES}/${licenseId}/verify`)
      .set(auth(token))
      .send({});
    assert.equal(noExpiry.status, 400);

    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    const verified = await request(app)
      .post(`${STAFF_LICENSES}/${licenseId}/verify`)
      .set(auth(token))
      .send({ expiryDate: expiry.toISOString().slice(0, 10) });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.data.license.status, "VERIFIED");

    // Quote: total = qty × unit price (+ delivery)
    const approved = await request(app)
      .post(`${STAFF}/${id}/approve`)
      .set(auth(token))
      .send({ unitPrice: 900, deliveryPrice: 50000 });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    const req1 = approved.body.data.request;
    assert.equal(req1.status, "APPROVED");
    assert.equal(Number(req1.totalAmount), 900 * DETAILS.quantity + 50000);
    assert.ok(req1.quotedAt, "quote timestamp must be stamped");

    // Frontend (api.ts) wire contract — asserted here on the already-built
    // APPROVED state (verified doc + signed agreement + quote) rather than in
    // a separate heavy e2e. The customer's PORTAL view is what api.ts's
    // toOrder / toDocument / toAgreement read; a rename here breaks the swap.
    const portal = await request(app).get(`${DD}/${id}`).set(auth(me.token));
    assert.equal(portal.status, 200, JSON.stringify(portal.body));
    const o = portal.body.data.order;
    for (const f of [
      "id", "requestNumber", "product", "productName", "quantity", "quantityUnit",
      "deliveryAddress", "deliveryState", "contactPerson", "contactPhone", "companyName",
      "companyNameNormalized", "status", "unitPrice", "totalAmount", "submittedAt",
      "approvedAt", "quotedAt", "paidAt", "createdAt", "updatedAt", "licenseId",
      "license", "agreement", "events",
    ]) {
      assert.ok(f in o, `portal order missing "${f}" — api.ts reads it`);
    }
    assert.match(o.requestNumber, /^DNG-\d{4}-\d{5}$/);
    assert.ok(o.unitPrice != null && o.totalAmount != null, "quote fields populated at APPROVED");

    const lic = o.license;
    assert.ok(lic, "the linked, verified license should be embedded");
    assert.equal(lic.status, "VERIFIED");
    for (const f of [
      "id", "companyName", "fileName", "fileSize", "mimeType", "status",
      "expiryDate", "verifiedAt", "createdAt",
    ]) {
      assert.ok(f in lic, `portal license missing "${f}"`);
    }
    assert.ok(!("storageKey" in lic), "storage keys must never reach the client");

    const ag = o.agreement;
    assert.ok(ag, "a signed agreement should be present");
    for (const f of [
      "id", "customerName", "companyName", "deliveryAddress", "deliveryState",
      "productCode", "productName", "quantity", "signature", "createdAt",
    ]) {
      assert.ok(f in ag, `portal agreement missing "${f}"`);
    }
    // initials is optional (SignatureRecord.initials?) — the wire omits it
    // when unset, which the frontend handles; only these are mandatory.
    for (const f of ["fullName", "signedAt", "termsVersion"]) {
      assert.ok(f in ag.signature, `signature missing "${f}"`);
    }
    assert.ok(!("unitPrice" in ag) && !("totalAmount" in ag), "agreement carries no money");
    for (const e of o.events) {
      assert.ok("event" in e && "at" in e, `event row missing fields: ${JSON.stringify(e)}`);
    }

    // Manual payment, then staff-advanced fulfilment
    const paid = await request(app).post(`${STAFF}/${id}/mark-paid`).set(auth(token));
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.equal(paid.body.data.request.status, "PAID");

    for (const [step, expected] of [
      ["schedule", "SCHEDULED"],
      ["dispatch", "DISPATCHED"],
      ["complete", "COMPLETED"],
    ]) {
      const res = await request(app).post(`${STAFF}/${id}/${step}`).set(auth(token)).send({});
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.data.request.status, expected);
    }

    // Completed is terminal — no further dispatch
    const again = await request(app).post(`${STAFF}/${id}/dispatch`).set(auth(token)).send({});
    assert.equal(again.status, 409);
  });

  test("request-changes loop reaches the customer with the note", async () => {
    const { id } = await submittedOrder(me, await createLicense(me));

    const missingNote = await request(app)
      .post(`${STAFF}/${id}/request-changes`)
      .set(auth(token))
      .send({});
    assert.equal(missingNote.status, 400, "the note is required");

    const sentBack = await request(app)
      .post(`${STAFF}/${id}/request-changes`)
      .set(auth(token))
      .send({ note: "License scan is blurry — upload a legible copy" });
    assert.equal(sentBack.status, 200, JSON.stringify(sentBack.body));
    assert.equal(sentBack.body.data.request.status, "NEEDS_CHANGES");

    // The customer sees the note on their timeline and can reopen
    const mine = await request(app).get(`${DD}/${id}`).set(auth(me.token));
    const event = mine.body.data.order.events.find((e) => e.event === "NEEDS_CHANGES");
    assert.ok(event, "NEEDS_CHANGES event must be on the timeline");
    assert.match(event.note, /blurry/);

    const reopened = await request(app).post(`${DD}/${id}/reopen`).set(auth(me.token));
    assert.equal(reopened.status, 200);
    assert.equal(reopened.body.data.order.status, "DRAFT");
    assert.equal(reopened.body.data.order.agreement, null, "agreement must be invalidated");
  });

  test("reject is terminal and requires a reason", async () => {
    const { id } = await submittedOrder(me, await createLicense(me));

    const missing = await request(app).post(`${STAFF}/${id}/reject`).set(auth(token)).send({});
    assert.equal(missing.status, 400);

    const rejected = await request(app)
      .post(`${STAFF}/${id}/reject`)
      .set(auth(token))
      .send({ reason: "Company failed compliance checks" });
    assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
    assert.equal(rejected.body.data.request.status, "REJECTED");

    const relist = await request(app)
      .post(`${STAFF}/${id}/approve`)
      .set(auth(token))
      .send({ unitPrice: 900 });
    assert.equal(relist.status, 409, "terminal states take no verdicts");
  });

  test("legacy request endpoints are gone", async () => {
    const res = await request(app).get("/api/dangote-order-requests").set(auth(token));
    assert.equal(res.status, 404);
  });

  test("customers cannot reach the staff desk", async () => {
    const res = await request(app).get(STAFF).set(auth(me.token));
    assert.ok([401, 403].includes(res.status), `expected auth failure, got ${res.status}`);
  });
});
