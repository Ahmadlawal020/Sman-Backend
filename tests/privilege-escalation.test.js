// Must precede any require that reaches config/db.
require("dotenv").config();

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../app");
const { staffRepo } = require("../repositories");
const { staffTokenWithRoles, closeDb } = require("./helpers");

/**
 * AUDIT H5. `PATCH /api/admin/:id` edits ordinary profile fields and the two
 * fields that decide what an account may do, and it carried no role gate.
 *
 * The exploit was one request: an `admin` PATCHes their own row with
 * `roles: [0]` and becomes a `super_admin`, defeating the super_admin gates on
 * staff creation and deletion.
 */
describe("privilege escalation — PATCH /api/admin/:id", () => {
  let plain;
  let superUser;

  before(async () => {
    plain = await staffTokenWithRoles(["admin"], "test-esc-admin@soroman.test");
    superUser = await staffTokenWithRoles(
      ["admin", "super_admin"],
      "test-esc-super@soroman.test"
    );
  });

  after(async () => {
    await closeDb();
  });

  test("an admin cannot promote themselves to super_admin", async () => {
    const res = await request(app)
      .patch(`/api/admin/${plain.staff.id}`)
      .set("Authorization", `Bearer ${plain.accessToken}`)
      // 0 maps to super_admin in config/roleMapping.
      .send({ roles: [0] });

    assert.equal(res.status, 403);

    const after = await staffRepo.findById(plain.staff.id);
    assert.ok(!after.roles.includes("super_admin"), `roles became ${after.roles}`);
  });

  test("an admin cannot promote somebody else either", async () => {
    const victim = await staffTokenWithRoles(["finance"], "test-esc-victim@soroman.test");

    const res = await request(app)
      .patch(`/api/admin/${victim.staff.id}`)
      .set("Authorization", `Bearer ${plain.accessToken}`)
      .send({ roles: [0] });

    assert.equal(res.status, 403);
    const after = await staffRepo.findById(victim.staff.id);
    assert.ok(!after.roles.includes("super_admin"));
  });

  test("an admin cannot suspend anyone", async () => {
    const victim = await staffTokenWithRoles(["finance"], "test-esc-victim2@soroman.test");

    const res = await request(app)
      .patch(`/api/admin/${victim.staff.id}`)
      .set("Authorization", `Bearer ${plain.accessToken}`)
      .send({ suspended: true });

    assert.equal(res.status, 403);
    assert.equal((await staffRepo.findById(victim.staff.id)).suspended, false);
  });

  test("but an admin CAN still edit their own profile", async () => {
    // The reason the gate is per-field rather than per-route: putting
    // requireRole("super_admin") on the route would have fixed the escalation
    // and broken this.
    const res = await request(app)
      .patch(`/api/admin/${plain.staff.id}`)
      .set("Authorization", `Bearer ${plain.accessToken}`)
      .send({ first_name: "Renamed", phone_number: "08012345678" });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await staffRepo.findById(plain.staff.id)).firstName, "Renamed");
  });

  test("a super admin can still change roles", async () => {
    const target = await staffTokenWithRoles(["finance"], "test-esc-target@soroman.test");

    const res = await request(app)
      .patch(`/api/admin/${target.staff.id}`)
      .set("Authorization", `Bearer ${superUser.accessToken}`)
      .send({ roles: [1] });

    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test("a super admin cannot suspend their own account", async () => {
    // Locking yourself out takes everyone with you: the role that could undo
    // it is the one being given away.
    const res = await request(app)
      .patch(`/api/admin/${superUser.staff.id}`)
      .set("Authorization", `Bearer ${superUser.accessToken}`)
      .send({ suspended: true });

    assert.equal(res.status, 400);
    assert.equal((await staffRepo.findById(superUser.staff.id)).suspended, false);
  });

  test("a super admin cannot demote themselves", async () => {
    const res = await request(app)
      .patch(`/api/admin/${superUser.staff.id}`)
      .set("Authorization", `Bearer ${superUser.accessToken}`)
      .send({ roles: [1] });

    assert.equal(res.status, 400);
    const after = await staffRepo.findById(superUser.staff.id);
    assert.ok(after.roles.includes("super_admin"), "still a super admin");
  });

  test("a super admin can suspend somebody else", async () => {
    const target = await staffTokenWithRoles(["finance"], "test-esc-suspendme@soroman.test");

    const res = await request(app)
      .patch(`/api/admin/${target.staff.id}`)
      .set("Authorization", `Bearer ${superUser.accessToken}`)
      .send({ suspended: true });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await staffRepo.findById(target.staff.id)).suspended, true);

    await staffRepo.update(target.staff.id, { suspended: false });
  });

  test("the super_admin gates on create and delete still hold", async () => {
    // These were the gates the escalation existed to defeat.
    const create = await request(app)
      .post("/api/admin")
      .set("Authorization", `Bearer ${plain.accessToken}`)
      .send({ first_name: "New", surname: "Person", email: "nope@soroman.test" });
    assert.equal(create.status, 403);

    const remove = await request(app)
      .delete(`/api/admin/${superUser.staff.id}`)
      .set("Authorization", `Bearer ${plain.accessToken}`);
    assert.equal(remove.status, 403);
  });
});
