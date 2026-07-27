const { pgEnum } = require("drizzle-orm/pg-core");

// "Pending" is the state POST /auth/register creates into: the customer may
// authenticate and browse, but not order until staff activate them.
const customerStatusEnum = pgEnum("customer_status", [
  "Active",
  "Inactive",
  "Pending",
]);

// Which realm a session belongs to. Drives the exclusive arc on `sessions`
// and the domain separation of refresh-token hashes.
const principalTypeEnum = pgEnum("principal_type", ["staff", "customer"]);

const driverStatusEnum = pgEnum("driver_status", [
  "Active",
  "On Trip",
  "Off Duty",
]);

const truckStatusEnum = pgEnum("truck_status", [
  "In Transit",
  "Idle",
  "Maintenance",
]);

const depotStatusEnum = pgEnum("depot_status", [
  "Active",
  "Maintenance",
  "High Capacity",
]);

const orderDeliveryTypeEnum = pgEnum("order_delivery_type", [
  "delivery",
  "pickup",
]);

const orderPaymentStatusEnum = pgEnum("order_payment_status", [
  "Unpaid",
  "Paid",
]);

// Pipeline: Pending → Paid → Released → Loading → Completed, with Cancelled as
// an exit. Processing was deliberately not added — the depot confirmed there is
// no distinct action between payment landing and release, so it would be a
// stage with no writer.
const orderStatusEnum = pgEnum("order_status", [
  "Pending",
  "Paid",
  "Released",
  "Loading",
  "Completed",
  "Cancelled",
]);

// Who performed an audited action. `system` is the webhook / automatic path;
// the exclusive arc on audit_logs mirrors the sessions table.
const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "staff",
  "customer",
  "system",
]);

// Per-truck movement. Enforced in order: pending → gated_in → loaded → gated_out.
const orderTruckStatusEnum = pgEnum("order_truck_status", [
  "pending",
  "gated_in",
  "loaded",
  "gated_out",
]);

const pfiStatusEnum = pgEnum("pfi_status", ["active", "finished"]);

const ticketStatusEnum = pgEnum("ticket_status", ["Active", "Redeemed"]);

const depositTypeEnum = pgEnum("deposit_type", ["credit", "debit"]);

const deliveryCustomerTypeEnum = pgEnum("delivery_customer_type", [
  "customer",
  "filling_station",
]);

const deliveryCustomerStatusEnum = pgEnum("delivery_customer_status", [
  "active",
  "dormant",
  "suspended",
]);

const deliveryNoteStatusEnum = pgEnum("delivery_note_status", [
  "Pending",
  "In Transit",
  "Delivered",
  "Cancelled",
]);

const loadingStatusEnum = pgEnum("loading_status", [
  "loaded",
  "offloaded",
  "empty",
]);

const depositStatusEnum = pgEnum("deposit_status_enum", [
  "pending",
  "paid",
  "partial",
]);

const paymentMethodEnum = pgEnum("payment_method", [
  "manual",
  "paystack_dva",
]);

const webhookStatusEnum = pgEnum("webhook_status", [
  "pending",
  "processed",
  "failed",
]);

module.exports = {
  customerStatusEnum,
  principalTypeEnum,
  auditActorTypeEnum,
  orderTruckStatusEnum,
  driverStatusEnum,
  truckStatusEnum,
  depotStatusEnum,
  orderDeliveryTypeEnum,
  orderPaymentStatusEnum,
  orderStatusEnum,
  pfiStatusEnum,
  ticketStatusEnum,
  depositTypeEnum,
  deliveryCustomerTypeEnum,
  deliveryCustomerStatusEnum,
  deliveryNoteStatusEnum,
  loadingStatusEnum,
  depositStatusEnum,
  paymentMethodEnum,
  webhookStatusEnum,
};
