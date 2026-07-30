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

// Lifecycle of a wallet hold: money committed at order time ("active"),
// then either spent ("converted", a debit deposit row is written) or
// returned ("released", balance restored with no ledger entry).
const walletHoldStatusEnum = pgEnum("wallet_hold_status", [
  "active",
  "converted",
  "released",
]);

// "customer" is the legacy catch-all; new records should use a specific type.
const deliveryCustomerTypeEnum = pgEnum("delivery_customer_type", [
  "customer",
  "filling_station",
  "third_party",
  "bulk",
  "retail",
  "wholesale",
  "corporate",
  "government",
  "other",
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

// Fleet ledger entries mirror Django's FleetLedgerEntry: an entry is either
// money spent on a truck or money it earned. Category stays free text there,
// matching the existing workflow.
const fleetEntryTypeEnum = pgEnum("fleet_entry_type", ["expense", "income"]);

// Sign-in providers beyond the phone number (which lives on customers
// itself). One identity row per provider per customer.
const customerIdentityProviderEnum = pgEnum("customer_identity_provider", [
  "email",
  "google",
  "apple",
  "pin",
]);


const dailyReportStatusEnum = pgEnum("daily_report_status", [
  "submitted",
  "approved",
  "rejected",
]);

const incidentTypeEnum = pgEnum("incident_type", [
  "incident",
  "expense",
  "maintenance",
  "observation",
  "compliance",
]);

const incidentStatusEnum = pgEnum("incident_status", [
  "submitted",
  "reviewed",
  "resolved",
  "rejected",
]);

const offlineSaleStatusEnum = pgEnum("offline_sale_status", [
  "pending",
  "approved",
  "rejected",
]);

const releaseStatusEnum = pgEnum("release_status", [
  "pending",
  "confirmed",
  "released",
]);

// Which surface created the customer. Three creation paths now exist and
// telling them apart matters for support and for activation rules — a
// WhatsApp-created customer skipped the OTP because the channel itself
// proved phone control.
const customerCreatedViaEnum = pgEnum("customer_created_via", [
  "desk",
  "portal",
  "whatsapp",
]);

// The conversation engine's states, persisted per session. Mirrors
// whatsapp/constants.js STATES — a session resumes exactly where it stopped.
const waSessionStateEnum = pgEnum("wa_session_state", [
  "IDENTIFY",
  "MENU",
  "DEPOT",
  "PRODUCT",
  "QUANTITY",
  "COLLECT",
  "LOGISTICS",
  "CONFIRM",
  "AWAIT_PAYMENT",
]);

const waMessageDirectionEnum = pgEnum("wa_message_direction", [
  "inbound",
  "outbound",
]);

// Inbound: received → processed. Outbound: queued → sent → delivered → read,
// or failed (send exhausted retries) / skipped (kill switch, no template).
// Every hop is recorded — the send path is never fire-and-forget.
const waMessageStatusEnum = pgEnum("wa_message_status", [
  "received",
  "processed",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "skipped",
]);

// Meta owns template approval; this mirrors their verdict locally so an
// outside-window send can check it without a network call.
const waTemplateStatusEnum = pgEnum("wa_template_status", [
  "pending",
  "approved",
  "rejected",
  "paused",
]);

const commissionStatusEnum = pgEnum("commission_status", [
  "pending",
  "paid",
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
  walletHoldStatusEnum,
  deliveryCustomerTypeEnum,
  deliveryCustomerStatusEnum,
  deliveryNoteStatusEnum,
  loadingStatusEnum,
  depositStatusEnum,
  paymentMethodEnum,
  webhookStatusEnum,
  fleetEntryTypeEnum,
  customerIdentityProviderEnum,
  dailyReportStatusEnum,
  incidentTypeEnum,
  incidentStatusEnum,
  offlineSaleStatusEnum,
  releaseStatusEnum,
  customerCreatedViaEnum,
  waSessionStateEnum,
  waMessageDirectionEnum,
  waMessageStatusEnum,
  waTemplateStatusEnum,
  commissionStatusEnum,
};
