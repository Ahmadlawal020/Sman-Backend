const enums = require("./enums");
const adminSchema = require("./admin");
const customerSchema = require("./customer");
const truckSchema = require("./truck");
const driverSchema = require("./driver");
const depotSchema = require("./depot");
const productSchema = require("./product");
const depotStaffSchema = require("./depotStaff");
const depotProductCapacitiesSchema = require("./depotProductCapacities");
const depotProductPricesSchema = require("./depotProductPrices");
const depotPriceHistorySchema = require("./depotPriceHistory");
const driverTruckHistorySchema = require("./driverTruckHistory");
const pfiSchema = require("./pfi");
const orderSchema = require("./order");
const ticketSchema = require("./ticket");
const depositSchema = require("./deposit");
const deliveryCustomerSchema = require("./deliveryCustomer");
const deliveryNoteSchema = require("./deliveryNote");
const deliveryInventorySchema = require("./deliveryInventory");
const deliverySaleSchema = require("./deliverySale");
const webhookEventSchema = require("./webhookEvent");

module.exports = {
  ...enums,
  ...adminSchema,
  ...customerSchema,
  ...truckSchema,
  ...driverSchema,
  ...depotSchema,
  ...productSchema,
  ...depotStaffSchema,
  ...depotProductCapacitiesSchema,
  ...depotProductPricesSchema,
  ...depotPriceHistorySchema,
  ...driverTruckHistorySchema,
  ...pfiSchema,
  ...orderSchema,
  ...ticketSchema,
  ...depositSchema,
  ...deliveryCustomerSchema,
  ...deliveryNoteSchema,
  ...deliveryInventorySchema,
  ...deliverySaleSchema,
  ...webhookEventSchema,
};
