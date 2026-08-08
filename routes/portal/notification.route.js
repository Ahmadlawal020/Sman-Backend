const express = require("express");
const router = express.Router();
const { authenticateCustomer } = require("../../middleware/verifyCustomer");
const validate = require("../../middleware/validate");
const schemas = require("../../schemas/notification.schema");
const ctrl = require("../../controllers/notification.controller");

/**
 * Customer-facing notifications — the mobile app's inbox and the web portal's
 * bell menu. Every handler is scoped to req.customer, so a customer can only
 * ever see, read or delete their own rows.
 *
 * `authenticateCustomer` rather than the full `verifyCustomer` chain: a
 * Pending customer (registered, phone not yet verified) still receives
 * notifications about that very verification, and must be able to read them.
 */

// The live stream mounts FIRST. "/stream" would otherwise be captured by the
// "/:id" routes below and rejected as an invalid id — Express matches in
// declaration order, and a literal path must precede the parameter that could
// swallow it.
router.get("/stream", ctrl.stream("customer"));
router.post("/stream-ticket", authenticateCustomer, ctrl.issueStreamTicket);

router.get("/unread-count", authenticateCustomer, ctrl.unreadCount);
router.get("/catalog", authenticateCustomer, ctrl.getCatalog);

// Preferences
router.get("/preferences", authenticateCustomer, ctrl.getPreferences);
router.patch(
  "/preferences",
  authenticateCustomer,
  validate({ body: schemas.updatePreferences }),
  ctrl.updatePreferences
);
router.post(
  "/preferences/reset",
  authenticateCustomer,
  validate({ body: schemas.resetPreferences }),
  ctrl.resetPreferences
);

// Push device registration
router.get("/devices", authenticateCustomer, ctrl.listDevices);
router.post(
  "/devices",
  authenticateCustomer,
  validate({ body: schemas.registerDevice }),
  ctrl.registerDevice
);
router.delete(
  "/devices",
  authenticateCustomer,
  validate({ body: schemas.unregisterDevice }),
  ctrl.unregisterDevice
);

// Bulk actions — before "/:id" for the same ordering reason as "/stream".
router.post("/read-all", authenticateCustomer, validate({ body: schemas.markAllRead }), ctrl.markAllRead);
router.post("/archive-all", authenticateCustomer, validate({ body: schemas.markAllRead }), ctrl.archiveAll);
router.post("/test", authenticateCustomer, validate({ body: schemas.sendTest }), ctrl.sendTest);

// Inbox
router.get("/", authenticateCustomer, validate({ query: schemas.listNotifications }), ctrl.list);
router.get("/:id", authenticateCustomer, validate({ params: schemas.notificationIdParam }), ctrl.getOne);
router.patch(
  "/:id/read",
  authenticateCustomer,
  validate({ params: schemas.notificationIdParam }),
  ctrl.markRead
);
router.patch(
  "/:id/unread",
  authenticateCustomer,
  validate({ params: schemas.notificationIdParam }),
  ctrl.markUnread
);
router.patch(
  "/:id/archive",
  authenticateCustomer,
  validate({ params: schemas.notificationIdParam }),
  ctrl.archive
);
router.delete("/:id", authenticateCustomer, validate({ params: schemas.notificationIdParam }), ctrl.remove);

module.exports = router;
