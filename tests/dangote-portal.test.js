// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { db } = require("../config/db");
const { dangoteDeliveryDocuments } = require("../db/schema");
const { eq } = require("drizzle-orm");
const { customerRepo } = require("../repositories");
const { NATIVE_TRANSPORT, closeDb } = require("./helpers");
const {
  normalizeCompanyName,
  PRODUCT_UNITS,
} = require("../services/dangoteDelivery/orders");

const PORTAL_AUTH = "/api/customer/auth";
const DD = "/api/customer/dangote-delivery-orders";
const DEV_CODE = process.env.OTP_DEV_CODE || "000000";
const RUN = Date.now();

const pdf = () => Buffer.from("%PDF-1.7\ntest license body");

async function registerActiveCustomer(tag) {
  const phone = `+234814${String(RUN).slice(-5)}${String(tag).padStart(2, "0")}`;
  const reg = await request(app)
    .post(`${PORTAL_AUTH}/register`)
    .send({ name: `Dangote Cust ${tag}`, phone });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));
  const ver = await request(app)
    .post(`${PORTAL_AUTH}/verify-otp`)
    .set(NATIVE_TRANSPORT)
    .send({ phone, code: DEV_CODE });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const customer = await customerRepo.findByPhone(phone);
  return { customer, token: ver.body.data.accessToken };
}

const auth = (token) => ({ Authorization: `Bearer ${token}`, ...NATIVE_TRANSPORT });

const DETAILS = {
  product: "PMS",
  quantity: 5000,
  deliveryAddress: "12 Refinery Road, Lekki",
  deliveryState: "Lagos",
  contactPerson: "Ada Obi",
  contactPhone: "+2348011122233",
};

describe("dangote delivery — company name normalization parity", () => {
  test("matches the frontend rules", () => {
    assert.equal(normalizeCompanyName("  OBI & Sons, Ltd.  "), "obi sons ltd");
    assert.equal(normalizeCompanyName("Émile-Fuels   NIGERIA"), "émilefuels nigeria");
    // "Ltd" vs "Limited" intentionally do NOT match
    assert.notEqual(normalizeCompanyName("Obi Ltd"), normalizeCompanyName("Obi Limited"));
  });

  test("unit map mirrors the frontend PRODUCT_META", () => {
    assert.deepEqual(PRODUCT_UNITS, { PMS: "litre", AGO: "litre", LPG: "kg" });
  });
});

describe("dangote delivery portal — the full quote-request wizard", () => {
  let me;
  let stranger;
  let orderId;

  before(async () => {
    me = await registerActiveCustomer(1);
    stranger = await registerActiveCustomer(2);
  });

  after(async () => {
    await closeDb();
  });

  test("creates a draft with server-derived unit and DNG request number", async () => {
    const res = await request(app).post(DD).set(auth(me.token)).send(DETAILS);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = res.body.data.order;
    orderId = order.id;
    assert.equal(order.status, "DRAFT");
    assert.equal(order.quantityUnit, "litre");
    assert.match(order.requestNumber, /^DNG-\d{4}-\d{5}$/);
    assert.equal(order.productName, "Petrol");
    assert.ok(!("reviewedBy" in order), "staff-only fields must not leak");
  });

  test("the request number works as the order id (the portal's reference)", async () => {
    const created = await request(app).get(`${DD}/${orderId}`).set(auth(me.token));
    const ref = created.body.data.order.requestNumber;
    const byRef = await request(app).get(`${DD}/${ref.toLowerCase()}`).set(auth(me.token));
    assert.equal(byRef.status, 200, JSON.stringify(byRef.body));
    assert.equal(byRef.body.data.order.id, orderId);
    const bogus = await request(app).get(`${DD}/DNG-9999-99999`).set(auth(me.token));
    assert.equal(bogus.status, 404);
  });

  test("a stranger cannot see or touch the order", async () => {
    const res = await request(app).get(`${DD}/${orderId}`).set(auth(stranger.token));
    assert.equal(res.status, 404);
    const patch = await request(app)
      .patch(`${DD}/${orderId}`)
      .set(auth(stranger.token))
      .send(DETAILS);
    assert.equal(patch.status, 404);
  });

  test("switching product to LPG re-derives the unit as kg", async () => {
    const res = await request(app)
      .patch(`${DD}/${orderId}`)
      .set(auth(me.token))
      .send({ ...DETAILS, product: "LPG" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.quantityUnit, "kg");
    // back to PMS for the rest of the flow
    const back = await request(app)
      .patch(`${DD}/${orderId}`)
      .set(auth(me.token))
      .send(DETAILS);
    assert.equal(back.status, 200);
  });

  test("cannot submit documents before company + license exist", async () => {
    const res = await request(app).post(`${DD}/${orderId}/documents/submit`).set(auth(me.token));
    assert.equal(res.status, 400);
  });

  test("sets company info with the normalized reuse key", async () => {
    const res = await request(app)
      .put(`${DD}/${orderId}/company`)
      .set(auth(me.token))
      .send({ companyName: "OBI & Sons, Ltd." });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.companyNameNormalized, "obi sons ltd");
  });

  test("uploads the license (magic-byte checked, storage key hidden)", async () => {
    const res = await request(app)
      .post(`${DD}/${orderId}/documents`)
      .set(auth(me.token))
      .attach("file", pdf(), { filename: "license.pdf", contentType: "application/pdf" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = res.body.data.document;
    assert.equal(doc.status, "PENDING");
    assert.equal(doc.mimeType, "application/pdf");
    assert.ok(!("storageKey" in doc), "storage keys must never be exposed");
  });

  test("rejects a disguised upload", async () => {
    const res = await request(app)
      .post(`${DD}/${orderId}/documents`)
      .set(auth(me.token))
      .attach("file", Buffer.from("<html>fake</html>"), {
        filename: "license.pdf",
        contentType: "application/pdf",
      });
    assert.equal(res.status, 400);
  });

  test("terms endpoint serves versioned sections", async () => {
    const res = await request(app).get(`${DD}/terms`).set(auth(me.token));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.version, "1.0");
    assert.ok(res.body.data.sections.length >= 8);
  });

  test("documents submit → sign → submit walks the machine", async () => {
    const submitDocs = await request(app)
      .post(`${DD}/${orderId}/documents/submit`)
      .set(auth(me.token));
    assert.equal(submitDocs.status, 200, JSON.stringify(submitDocs.body));
    assert.equal(submitDocs.body.data.order.status, "DOCUMENTS_SUBMITTED");

    const sign = await request(app)
      .post(`${DD}/${orderId}/agreement`)
      .set(auth(me.token))
      .send({ fullName: "Ada Obi", initials: "AO" });
    assert.equal(sign.status, 200, JSON.stringify(sign.body));
    const order = sign.body.data.order;
    assert.equal(order.status, "AGREEMENT_ACCEPTED");
    assert.equal(order.agreement.signature.fullName, "Ada Obi");
    assert.equal(order.agreement.signature.termsVersion, "1.0");
    assert.ok(!("unitPrice" in order.agreement), "agreements carry no money");

    const submit = await request(app).post(`${DD}/${orderId}/submit`).set(auth(me.token));
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    assert.equal(submit.body.data.order.status, "UNDER_REVIEW");
    assert.ok(submit.body.data.order.submittedAt);

    const events = submit.body.data.order.events.map((e) => e.event);
    for (const expected of ["DRAFT", "DOCUMENT_UPLOADED", "DOCUMENTS_SUBMITTED", "AGREEMENT_ACCEPTED", "UNDER_REVIEW"]) {
      assert.ok(events.includes(expected), `timeline missing ${expected}: ${events}`);
    }
  });

  test("details are frozen after submission", async () => {
    const res = await request(app)
      .patch(`${DD}/${orderId}`)
      .set(auth(me.token))
      .send(DETAILS);
    assert.equal(res.status, 409);
  });

  test("verified documents become reusable for the same company", async () => {
    // Verify directly in the DB (the staff endpoint is exercised in its own
    // suite); expiry one year out, as printed on a real certificate.
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 1);
    await db
      .update(dangoteDeliveryDocuments)
      .set({
        status: "VERIFIED",
        verifiedAt: new Date(),
        expiryDate: expiry.toISOString().slice(0, 10),
      })
      .where(eq(dangoteDeliveryDocuments.orderId, orderId));

    const miss = await request(app)
      .get(`${DD}/reusable-company`)
      .query({ name: "Another Company" })
      .set(auth(me.token));
    assert.equal(miss.body.data.company, null);

    const hit = await request(app)
      .get(`${DD}/reusable-company`)
      .query({ name: "obi & SONS ltd" })
      .set(auth(me.token));
    assert.equal(hit.status, 200);
    assert.ok(hit.body.data.company, "same normalized company must match");
    assert.equal(hit.body.data.company.documents[0].status, "VERIFIED");

    // A different customer never sees them.
    const foreign = await request(app)
      .get(`${DD}/reusable-company`)
      .query({ name: "OBI & Sons, Ltd." })
      .set(auth(stranger.token));
    assert.equal(foreign.body.data.company, null);
  });

  test("a second order reuses the verified document end-to-end", async () => {
    const created = await request(app).post(DD).set(auth(me.token)).send(DETAILS);
    const second = created.body.data.order;
    await request(app)
      .put(`${DD}/${second.id}/company`)
      .set(auth(me.token))
      .send({ companyName: "OBI & Sons, Ltd." });

    const reusable = await request(app)
      .get(`${DD}/reusable-company`)
      .query({ name: "OBI & Sons, Ltd." })
      .set(auth(me.token));
    const docId = reusable.body.data.company.documents[0].id;

    const reuse = await request(app)
      .post(`${DD}/${second.id}/documents/reuse`)
      .set(auth(me.token))
      .send({ documentIds: [docId] });
    assert.equal(reuse.status, 200, JSON.stringify(reuse.body));
    assert.equal(reuse.body.data.documents[0].status, "VERIFIED", "verification carries over");

    const submitDocs = await request(app)
      .post(`${DD}/${second.id}/documents/submit`)
      .set(auth(me.token));
    assert.equal(submitDocs.status, 200);
  });

  test("cancel works from UNDER_REVIEW (the declared cancellable set)", async () => {
    const res = await request(app).post(`${DD}/${orderId}/cancel`).set(auth(me.token));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.order.status, "CANCELLED");

    const again = await request(app).post(`${DD}/${orderId}/cancel`).set(auth(me.token));
    assert.equal(again.status, 409, "terminal states cannot cancel again");
  });
});
