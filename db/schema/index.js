const enums = require("./enums");
const staffSchema = require("./staff");
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
const walletHoldSchema = require("./walletHold");
const deliveryCustomerSchema = require("./deliveryCustomer");
const deliveryNoteSchema = require("./deliveryNote");
const deliveryInventorySchema = require("./deliveryInventory");
const deliverySaleSchema = require("./deliverySale");
const webhookEventSchema = require("./webhookEvent");
const sessionSchema = require("./session");
const customerOtpSchema = require("./customerOtp");
const auditLogSchema = require("./auditLog");
const orderTruckSchema = require("./orderTruck");
const customerIdentitySchema = require("./customerIdentity");
const auditEventSchema = require("./auditEvent");
const fleetTruckSchema = require("./fleetTruck");
const fleetLedgerSchema = require("./fleetLedgerEntry");
const dailyReportSchema = require("./dailyReport");
const incidentRecordSchema = require("./incidentRecord");
const offlineSaleSchema = require("./offlineSale");
const dangoteProductSchema = require("./dangoteProduct");
const dangoteOrderRequestSchema = require("./dangoteOrderRequest");
const waSessionSchema = require("./waSession");
const waMessageSchema = require("./waMessage");
const waTemplateSchema = require("./waTemplate");
const bankAccountSchema = require("./bankAccount");
const depotProductCommissionSchema = require("./depotProductCommission");
const commissionSchema = require("./commission");

module.exports = {
  ...enums,
  ...staffSchema,
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
  ...walletHoldSchema,
  ...deliveryCustomerSchema,
  ...deliveryNoteSchema,
  ...deliveryInventorySchema,
  ...deliverySaleSchema,
  ...webhookEventSchema,
  ...sessionSchema,
  ...customerOtpSchema,
  ...auditLogSchema,
  ...orderTruckSchema,
  ...customerIdentitySchema,
  ...auditEventSchema,
  ...fleetTruckSchema,
  ...fleetLedgerSchema,
  ...dailyReportSchema,
  ...incidentRecordSchema,
  ...offlineSaleSchema,
  ...dangoteProductSchema,
  ...dangoteOrderRequestSchema,
  ...waSessionSchema,
  ...waMessageSchema,
  ...waTemplateSchema,
  ...bankAccountSchema,
  ...depotProductCommissionSchema,
  ...commissionSchema,
};
