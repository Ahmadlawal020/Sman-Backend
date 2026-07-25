const { relations } = require("drizzle-orm");
const {
  admins,
  customers,
  trucks,
  drivers,
  depots,
  products,
  depotStaff,
  depotProductCapacities,
  depotProductPrices,
  depotPriceHistory,
  driverTruckHistory,
  pfis,
  orders,
  tickets,
  deposits,
  deliveryCustomers,
  deliveryNotes,
  deliveryInventory,
  deliverySales,
} = require("./schema");

// ─── Admin Relations ─────────────────────────────────────────────────────────

const adminsRelations = relations(admins, ({ many }) => ({
  depotStaff: many(depotStaff),
  recordedDeposits: many(deposits, { relationName: "recordedBy" }),
  redeemedTickets: many(tickets, { relationName: "redeemedBy" }),
  pfisAudit: many(pfis, { relationName: "auditOfficer" }),
  pfisProduct: many(pfis, { relationName: "productOfficer" }),
  pfisItCompliance: many(pfis, { relationName: "itComplianceOfficer" }),
  pfisSecurityExit: many(pfis, { relationName: "securityExitOfficer" }),
  pfisCommission: many(pfis, { relationName: "commissionOfficer" }),
  pfisSalesManager: many(pfis, { relationName: "salesManager" }),
  deliveryCustomersCreated: many(deliveryCustomers, { relationName: "createdBy" }),
  deliveryNotesCreated: many(deliveryNotes, { relationName: "createdBy" }),
}));

// ─── Customer Relations ──────────────────────────────────────────────────────

const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  deposits: many(deposits),
}));

// ─── Truck Relations ─────────────────────────────────────────────────────────

const trucksRelations = relations(trucks, ({ one, many }) => ({
  currentDriver: one(drivers, {
    fields: [trucks.currentDriverId],
    references: [drivers.id],
    relationName: "truckCurrentDriver",
  }),
  driverHistory: many(driverTruckHistory),
  deliveryInventory: many(deliveryInventory),
}));

// ─── Driver Relations ────────────────────────────────────────────────────────

const driversRelations = relations(drivers, ({ one, many }) => ({
  assignedTruck: one(trucks, {
    fields: [drivers.assignedTruckId],
    references: [trucks.id],
    relationName: "driverAssignedTruck",
  }),
  truckHistory: many(driverTruckHistory),
}));

// ─── Depot Relations ─────────────────────────────────────────────────────────

const depotsRelations = relations(depots, ({ many }) => ({
  staff: many(depotStaff),
  productCapacities: many(depotProductCapacities),
  productPrices: many(depotProductPrices),
  pfis: many(pfis),
  orders: many(orders),
}));

// ─── Product Relations ───────────────────────────────────────────────────────

const productsRelations = relations(products, ({ many }) => ({
  depotCapacities: many(depotProductCapacities),
  depotPrices: many(depotProductPrices),
  pfis: many(pfis),
  orders: many(orders),
}));

// ─── Junction Table Relations ────────────────────────────────────────────────

const depotStaffRelations = relations(depotStaff, ({ one }) => ({
  depot: one(depots, {
    fields: [depotStaff.depotId],
    references: [depots.id],
  }),
  admin: one(admins, {
    fields: [depotStaff.adminId],
    references: [admins.id],
  }),
}));

const depotProductCapacitiesRelations = relations(depotProductCapacities, ({ one }) => ({
  depot: one(depots, {
    fields: [depotProductCapacities.depotId],
    references: [depots.id],
  }),
  product: one(products, {
    fields: [depotProductCapacities.productId],
    references: [products.id],
  }),
}));

const depotProductPricesRelations = relations(depotProductPrices, ({ one, many }) => ({
  depot: one(depots, {
    fields: [depotProductPrices.depotId],
    references: [depots.id],
  }),
  product: one(products, {
    fields: [depotProductPrices.productId],
    references: [products.id],
  }),
  priceHistory: many(depotPriceHistory),
}));

const depotPriceHistoryRelations = relations(depotPriceHistory, ({ one }) => ({
  depotProductPrice: one(depotProductPrices, {
    fields: [depotPriceHistory.depotProductPriceId],
    references: [depotProductPrices.id],
  }),
}));

const driverTruckHistoryRelations = relations(driverTruckHistory, ({ one }) => ({
  driver: one(drivers, {
    fields: [driverTruckHistory.driverId],
    references: [drivers.id],
  }),
  truck: one(trucks, {
    fields: [driverTruckHistory.truckId],
    references: [trucks.id],
  }),
}));

// ─── PFI Relations ───────────────────────────────────────────────────────────

const pfisRelations = relations(pfis, ({ one, many }) => ({
  location: one(depots, {
    fields: [pfis.locationId],
    references: [depots.id],
  }),
  product: one(products, {
    fields: [pfis.productId],
    references: [products.id],
  }),
  auditOfficer: one(admins, {
    fields: [pfis.auditOfficerId],
    references: [admins.id],
    relationName: "auditOfficer",
  }),
  productOfficer: one(admins, {
    fields: [pfis.productOfficerId],
    references: [admins.id],
    relationName: "productOfficer",
  }),
  itComplianceOfficer: one(admins, {
    fields: [pfis.itComplianceOfficerId],
    references: [admins.id],
    relationName: "itComplianceOfficer",
  }),
  securityExitOfficer: one(admins, {
    fields: [pfis.securityExitOfficerId],
    references: [admins.id],
    relationName: "securityExitOfficer",
  }),
  commissionOfficer: one(admins, {
    fields: [pfis.commissionOfficerId],
    references: [admins.id],
    relationName: "commissionOfficer",
  }),
  salesManager: one(admins, {
    fields: [pfis.salesManagerId],
    references: [admins.id],
    relationName: "salesManager",
  }),
  orders: many(orders),
  deliveryInventory: many(deliveryInventory),
}));

// ─── Order Relations ─────────────────────────────────────────────────────────

const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  depot: one(depots, {
    fields: [orders.depotId],
    references: [depots.id],
  }),
  product: one(products, {
    fields: [orders.productId],
    references: [products.id],
  }),
  pfi: one(pfis, {
    fields: [orders.pfiId],
    references: [pfis.id],
  }),
  tickets: many(tickets),
}));

// ─── Ticket Relations ────────────────────────────────────────────────────────

const ticketsRelations = relations(tickets, ({ one }) => ({
  order: one(orders, {
    fields: [tickets.orderId],
    references: [orders.id],
  }),
  redeemer: one(admins, {
    fields: [tickets.redeemedBy],
    references: [admins.id],
    relationName: "redeemedBy",
  }),
}));

// ─── Deposit Relations ───────────────────────────────────────────────────────

const depositsRelations = relations(deposits, ({ one }) => ({
  customer: one(customers, {
    fields: [deposits.customerId],
    references: [customers.id],
  }),
  recorder: one(admins, {
    fields: [deposits.recordedBy],
    references: [admins.id],
    relationName: "recordedBy",
  }),
}));

// ─── Delivery Customer Relations ─────────────────────────────────────────────

const deliveryCustomersRelations = relations(deliveryCustomers, ({ one, many }) => ({
  creator: one(admins, {
    fields: [deliveryCustomers.createdBy],
    references: [admins.id],
    relationName: "createdBy",
  }),
  deliveryNotes: many(deliveryNotes),
  deliveryInventory: many(deliveryInventory),
  deliverySales: many(deliverySales),
}));

// ─── Delivery Note Relations ─────────────────────────────────────────────────

const deliveryNotesRelations = relations(deliveryNotes, ({ one }) => ({
  customer: one(deliveryCustomers, {
    fields: [deliveryNotes.customerId],
    references: [deliveryCustomers.id],
  }),
  order: one(orders, {
    fields: [deliveryNotes.orderId],
    references: [orders.id],
  }),
  creator: one(admins, {
    fields: [deliveryNotes.createdBy],
    references: [admins.id],
    relationName: "createdBy",
  }),
}));

// ─── Delivery Inventory Relations ────────────────────────────────────────────

const deliveryInventoryRelations = relations(deliveryInventory, ({ one }) => ({
  truck: one(trucks, {
    fields: [deliveryInventory.truckId],
    references: [trucks.id],
  }),
  pfi: one(pfis, {
    fields: [deliveryInventory.pfiId],
    references: [pfis.id],
  }),
  customer: one(deliveryCustomers, {
    fields: [deliveryInventory.customerId],
    references: [deliveryCustomers.id],
  }),
}));

// ─── Delivery Sales Relations ────────────────────────────────────────────────

const deliverySalesRelations = relations(deliverySales, ({ one }) => ({
  customer: one(deliveryCustomers, {
    fields: [deliverySales.customerId],
    references: [deliveryCustomers.id],
  }),
}));

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  adminsRelations,
  customersRelations,
  trucksRelations,
  driversRelations,
  depotsRelations,
  productsRelations,
  depotStaffRelations,
  depotProductCapacitiesRelations,
  depotProductPricesRelations,
  depotPriceHistoryRelations,
  driverTruckHistoryRelations,
  pfisRelations,
  ordersRelations,
  ticketsRelations,
  depositsRelations,
  deliveryCustomersRelations,
  deliveryNotesRelations,
  deliveryInventoryRelations,
  deliverySalesRelations,
};
