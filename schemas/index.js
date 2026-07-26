const authSchemas = require("./auth.schema");
const orderSchemas = require("./order.schema");
const customerSchemas = require("./customer.schema");
const truckSchemas = require("./truck.schema");
const driverSchemas = require("./driver.schema");
const depotSchemas = require("./depot.schema");
const productSchemas = require("./product.schema");
const adminSchemas = require("./admin.schema");
const ticketSchemas = require("./ticket.schema");
const depositSchemas = require("./deposit.schema");
const pfiSchemas = require("./pfi.schema");
const deliveryCustomerSchemas = require("./deliveryCustomer.schema");
const deliverySaleSchemas = require("./deliverySale.schema");
const deliveryInventorySchemas = require("./deliveryInventory.schema");
const filingStationSchemas = require("./filingStation.schema");

module.exports = {
  ...authSchemas,
  ...orderSchemas,
  ...customerSchemas,
  ...truckSchemas,
  ...driverSchemas,
  ...depotSchemas,
  ...productSchemas,
  ...adminSchemas,
  ...ticketSchemas,
  ...depositSchemas,
  ...pfiSchemas,
  ...deliveryCustomerSchemas,
  ...deliverySaleSchemas,
  ...deliveryInventorySchemas,
  ...filingStationSchemas,
};
