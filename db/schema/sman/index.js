// Tables with no live counterpart in soroman_db, plus "extras" tables for
// live tables that map but are missing fields Sman-Backend relies on
// (docs/LIVE_DB_CUTOVER.md §4, corrected and expanded — the brief's original
// count of 12 missed roughly 20 more). Scoped to the `sman` Postgres schema —
// Sman-Backend owns everything in here; Django owns public.
const enums = require("./enums");

// Customer auth stack
const customerIdentitySchema = require("./customerIdentity");
const customerOtpSchema = require("./customerOtp");

// Fleet / depot
const driverSchema = require("./driver");
const driverTruckHistorySchema = require("./driverTruckHistory");
const truckExtrasSchema = require("./truckExtras");
const dailyReportExtrasSchema = require("./dailyReportExtras");
const sessionSchema = require("./session");
const deliveryNoteSchema = require("./deliveryNote");

// System-wide audit trail (no live Django counterpart — see sman/auditLog.js)
const auditLogSchema = require("./auditLog");
const auditEventSchema = require("./auditEvent");
const depotStaffSchema = require("./depotStaff");
const lpgStationStaffSchema = require("./lpgStationStaff");
const pfiStaffSchema = require("./pfiStaff");
const depotPriceHistorySchema = require("./depotPriceHistory");
const depotProductCapacitiesSchema = require("./depotProductCapacities");
const depotProductCommissionSchema = require("./depotProductCommission");
const depotExtrasSchema = require("./depotExtras");

// Wallet / webhooks / expected payments / order deposit allocations / credits
const customerCreditSchema = require("./customerCredit");
const walletHoldSchema = require("./walletHold");
const webhookEventSchema = require("./webhookEvent");
const expectedPaymentSchema = require("./expectedPayment");
const orderDepositAllocationSchema = require("./orderDepositAllocation");

// Commissions
const commissionSchema = require("./commission");

// PFI expense extras (vendor master + VAT/WHT/payment fields) + comments
const vendorSchema = require("./vendor");
const pfiExpenseExtrasSchema = require("./pfiExpenseExtras");
const pfiExpenseCommentSchema = require("./pfiExpenseComment");
const expenseCategoryExtrasSchema = require("./expenseCategoryExtras");

// Bank account extras
const bankAccountExtrasSchema = require("./bankAccountExtras");

// LPG
const lpgStationCylinderSchema = require("./lpgStationCylinder");
const lpgPriceHistorySchema = require("./lpgPriceHistory");
const lpgStationExtrasSchema = require("./lpgStationExtras");

// Customer licenses + Dangote order line
const customerLicenseSchema = require("./customerLicense");
const dangoteProductSchema = require("./dangoteProduct");
const dangoteOrderRequestSchema = require("./dangoteOrderRequest");
const lpgOrderRequestSchema = require("./lpgOrderRequest");

// Staff UI customisation + password reset
const staffPageOverrideSchema = require("./staffPageOverride");
const staffPasswordResetSchema = require("./staffPasswordReset");

// Notifications engine
const deviceTokenSchema = require("./deviceToken");
const notificationSchema = require("./notification");
const notificationDeliverySchema = require("./notificationDelivery");
const notificationPreferenceSchema = require("./notificationPreference");
const messageTemplateSchema = require("./messageTemplate");

// WhatsApp ordering engine
const waSessionSchema = require("./waSession");
const waMessageSchema = require("./waMessage");
const waTemplateSchema = require("./waTemplate");

module.exports = {
  ...enums,
  ...customerIdentitySchema,
  ...customerOtpSchema,
  ...driverSchema,
  ...driverTruckHistorySchema,
  ...truckExtrasSchema,
  ...dailyReportExtrasSchema,
  ...sessionSchema,
  ...deliveryNoteSchema,
  ...auditLogSchema,
  ...auditEventSchema,
  ...depotStaffSchema,
  ...lpgStationStaffSchema,
  ...pfiStaffSchema,
  ...depotPriceHistorySchema,
  ...depotProductCapacitiesSchema,
  ...depotProductCommissionSchema,
  ...depotExtrasSchema,
  ...customerCreditSchema,
  ...walletHoldSchema,
  ...webhookEventSchema,
  ...expectedPaymentSchema,
  ...orderDepositAllocationSchema,
  ...commissionSchema,
  ...vendorSchema,
  ...pfiExpenseExtrasSchema,
  ...pfiExpenseCommentSchema,
  ...expenseCategoryExtrasSchema,
  ...bankAccountExtrasSchema,
  ...lpgStationCylinderSchema,
  ...lpgPriceHistorySchema,
  ...lpgStationExtrasSchema,
  ...customerLicenseSchema,
  ...dangoteProductSchema,
  ...dangoteOrderRequestSchema,
  ...lpgOrderRequestSchema,
  ...staffPageOverrideSchema,
  ...staffPasswordResetSchema,
  ...deviceTokenSchema,
  ...notificationSchema,
  ...notificationDeliverySchema,
  ...notificationPreferenceSchema,
  ...messageTemplateSchema,
  ...waSessionSchema,
  ...waMessageSchema,
  ...waTemplateSchema,
};
