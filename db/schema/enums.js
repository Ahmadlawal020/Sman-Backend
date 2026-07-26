const { pgEnum } = require("drizzle-orm/pg-core");

const customerStatusEnum = pgEnum("customer_status", ["Active", "Inactive"]);

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
