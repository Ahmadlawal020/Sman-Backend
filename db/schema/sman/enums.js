// Postgres enums for the sman-owned tables only. Django's soroman_db has zero
// enums (varchar + app-level choices) — these are scoped to the `sman`
// Postgres schema and never touch anything Django owns.
const { pgSchema } = require("drizzle-orm/pg-core");

const smanSchema = pgSchema("sman");

const driverStatusEnum = smanSchema.enum("driver_status", ["Active", "On Trip", "Off Duty"]);

const auditActorTypeEnum = smanSchema.enum("audit_actor_type", ["staff", "customer", "system"]);

const deliveryCustomerTypeEnum = smanSchema.enum("delivery_customer_type", ["customer", "filling_station"]);

const deliveryNoteStatusEnum = smanSchema.enum("delivery_note_status", [
  "Pending",
  "In Transit",
  "Delivered",
  "Cancelled",
]);

const walletHoldStatusEnum = smanSchema.enum("wallet_hold_status", ["active", "converted", "released"]);

const webhookStatusEnum = smanSchema.enum("webhook_status", ["pending", "processed", "failed"]);

const customerIdentityProviderEnum = smanSchema.enum("customer_identity_provider", [
  "email",
  "google",
  "apple",
  "pin",
]);

const licenseVerificationStatusEnum = smanSchema.enum("license_verification_status", [
  "pending",
  "approved",
  "rejected",
]);

const commissionStatusEnum = smanSchema.enum("commission_status", ["pending", "paid"]);

// staff | customer — used by device_tokens / notifications / notification
// preferences+settings for their exclusive-arc recipient columns.
const principalTypeEnum = smanSchema.enum("principal_type", ["staff", "customer"]);

const deviceTokenPlatformEnum = smanSchema.enum("device_token_platform", ["android", "ios", "web"]);

const notificationCategoryEnum = smanSchema.enum("notification_category", [
  "orders",
  "payments",
  "delivery",
  "tickets",
  "account",
  "security",
  "reports",
  "operations",
  "marketing",
  "system",
]);

const notificationPriorityEnum = smanSchema.enum("notification_priority", ["low", "normal", "high", "urgent"]);

const notificationChannelEnum = smanSchema.enum("notification_channel", [
  "in_app",
  "push",
  "email",
  "sms",
  "whatsapp",
]);

const notificationDeliveryStatusEnum = smanSchema.enum("notification_delivery_status", [
  "pending",
  "sent",
  "delivered",
  "failed",
  "skipped",
  "suppressed",
]);

const waMessageDirectionEnum = smanSchema.enum("wa_message_direction", ["inbound", "outbound"]);

const waMessageStatusEnum = smanSchema.enum("wa_message_status", [
  "received",
  "processed",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
]);

const waSessionStateEnum = smanSchema.enum("wa_session_state", [
  "IDENTIFY",
  "MENU",
  "DEPOT",
  "PRODUCT",
  "QUANTITY",
  "COMPANY",
  "COLLECT",
  "LOGISTICS",
  "CONFIRM",
  "AWAIT_PAYMENT",
]);

const waTemplateStatusEnum = smanSchema.enum("wa_template_status", ["pending", "approved", "rejected", "paused"]);

module.exports = {
  smanSchema,
  driverStatusEnum,
  auditActorTypeEnum,
  deliveryCustomerTypeEnum,
  deliveryNoteStatusEnum,
  walletHoldStatusEnum,
  webhookStatusEnum,
  customerIdentityProviderEnum,
  licenseVerificationStatusEnum,
  commissionStatusEnum,
  principalTypeEnum,
  deviceTokenPlatformEnum,
  notificationCategoryEnum,
  notificationPriorityEnum,
  notificationChannelEnum,
  notificationDeliveryStatusEnum,
  waMessageDirectionEnum,
  waMessageStatusEnum,
  waSessionStateEnum,
  waTemplateStatusEnum,
};
