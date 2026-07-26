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

const orderStatusEnum = pgEnum("order_status", [
  "Pending",
  "Completed",
  "Cancelled",
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

const auditActorTypeEnum = pgEnum("audit_actor_type", [
  "staff",
  "customer",
  "system",
]);

// Which kind of thing a ledger account belongs to. One engine, three books:
// delivery customers, filling stations, fleet trucks.
const ledgerOwnerTypeEnum = pgEnum("ledger_owner_type", [
  "delivery_customer",
  "filling_station",
  "fleet_truck",
]);

// Debit increases what the owner owes us (sale, expense); credit decreases it
// (payment, income). Running balance = debits - credits = outstanding.
const ledgerDirectionEnum = pgEnum("ledger_direction", ["debit", "credit"]);

const ledgerCategoryEnum = pgEnum("ledger_category", [
  "opening_balance",
  "sale",
  "purchase",
  "payment",
  "credit_note",
  "debit_note",
  "discount",
  "adjustment",
  "expense",
  "income",
  "fuel",
  "repairs",
  "tyres",
  "maintenance",
  "driver_allowance",
  "toll",
  "insurance",
  "registration",
  "commission",
  "other",
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

module.exports = {
  customerStatusEnum,
  principalTypeEnum,
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
  auditActorTypeEnum,
  ledgerOwnerTypeEnum,
  ledgerDirectionEnum,
  ledgerCategoryEnum,
  dailyReportStatusEnum,
  incidentTypeEnum,
  incidentStatusEnum,
  offlineSaleStatusEnum,
  releaseStatusEnum,
};
