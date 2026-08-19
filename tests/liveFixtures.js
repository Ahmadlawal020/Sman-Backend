// Shared fixture factories for the live (post-cutover) schema.
//
// The suites used to build fixtures with raw inserts into the old clean-room
// tables (`depots`, `products`, `orders`, …) — none of which exist on
// soroman_db. These factories speak the live vocabulary instead:
//
//  - Repositories are used wherever one exists (they already translate the
//    legacy caller shape into the live tables — consumer_depots +
//    sman.depot_extras, consumer_customer, consumer_order +
//    consumer_orderproduct, …).
//  - Pure-live tables with no repository (consumer_states, consumer_product,
//    consumer_productprice) are inserted directly, with every Django-side
//    NOT NULL supplied — the live schema has NO DB defaults for them
//    (Django fills these app-side; see docs/LIVE_DB_CUTOVER.md).
//
// Vocabulary that changed with the cutover, encoded here so individual test
// files don't have to know it:
//  - Order status is Django's lowercase set ("pending", "paid", "released",
//    "loaded", "completed", "canceled"), not the old capitalized one.
//  - Orders have no depotId — they carry stateId (their own state FK) and
//    optionally pfiId. Pricing/stock is per product+state
//    (consumer_productprice), not per depot.
//  - placeOrder pays into the depot's own bank account (manual deposit only,
//    no Paystack DVA), so any depot used to place orders needs one linked —
//    pass { bankAccount: true } to seedDepot.
require("dotenv").config();

const { db } = require("../config/db");
const {
  consumerStates,
  consumerProduct,
  consumerProductprice,
} = require("../db/schema");
const { customerRepo, depotRepo, pfiRepo, orderRepo, bankAccountRepo, truckRepo, lpgStationRepo } = require("../repositories");

const now = () => new Date().toISOString();

let seq = 0;
/** Unique-enough suffix so parallel/repeat runs never collide on names. */
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** consumer_states row — every NOT NULL filled. */
async function seedState(overrides = {}) {
  const [row] = await db
    .insert(consumerStates)
    .values({
      name: `Test State ${uniq()}`,
      abbreviation: `TS${uniq()}`.slice(0, 10),
      status: "active",
      classifier: "depot",
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row;
}

/** consumer_product row — every NOT NULL filled. */
async function seedProduct(overrides = {}) {
  const [row] = await db
    .insert(consumerProduct)
    .values({
      name: `Test Product ${uniq()}`,
      abbreviation: `TP${uniq()}`.slice(0, 10),
      description: "",
      unit: "Liters",
      stockQuantity: 1000000,
      initialStockQuantity: 1000000,
      isDeleted: false,
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .returning();
  return row;
}

/**
 * consumer_productprice row (unique on product_id+state_id). This is the
 * live replacement for the old per-depot price: pricing AND order stock are
 * tracked per product+state.
 */
async function seedPrice(productId, stateId, overrides = {}) {
  const [row] = await db
    .insert(consumerProductprice)
    .values({
      productId,
      stateId,
      price: "100.00",
      stockQuantity: 1000000,
      initialStockQuantity: 1000000,
      createdAt: now(),
      updatedAt: now(),
      ...overrides,
    })
    .onConflictDoUpdate({
      target: [consumerProductprice.productId, consumerProductprice.stateId],
      set: { price: overrides.price ?? "100.00", stockQuantity: overrides.stockQuantity ?? 1000000, updatedAt: now() },
    })
    .returning();
  return row;
}

/**
 * Depot via depotRepo (consumer_depots + sman.depot_extras). `location` is
 * NOT NULL on the live table and the repo does not default it, so it is
 * always supplied here. With { bankAccount: true }, links an Active default
 * bank account — placeOrder refuses depots without one. Pass an object
 * instead of true to override its fields (e.g. a predictable accountNumber
 * a test needs to assert on).
 */
async function seedDepot({ bankAccount = false, ...overrides } = {}) {
  const depot = await depotRepo.create({
    name: `Test Depot ${uniq()}`,
    location: "Lagos",
    code: `TD${uniq()}`.slice(0, 10),
    status: "Active",
    ...overrides,
  });
  if (bankAccount) {
    await bankAccountRepo.create({
      bankName: "Test Bank",
      accountName: `${depot.name} Account`,
      accountNumber: `TDACC${depot.id}${Date.now() % 100000}`,
      depotIds: [depot.id],
      status: "Active",
      isDefault: true,
      ...(bankAccount === true ? {} : bankAccount),
    });
  }
  return depot;
}

/** PFI via pfiRepo — needs a real product + state (locationId) to point at. */
async function seedPfi({ productId, locationId, ...overrides }) {
  return pfiRepo.create({
    pfiNumber: `PFI-${uniq()}`,
    productId,
    locationId,
    startingQtyLitres: "1000000.00",
    status: overrides.status ?? "active",
    createdAt: now(),
    ...overrides,
  });
}

/** Customer via customerRepo (accepts the legacy {name, phone} shape). */
async function seedCustomer(overrides = {}) {
  return customerRepo.create({
    name: `Fixture Customer ${uniq()}`,
    phone: `+23480${String(Date.now()).slice(-8)}`,
    companyName: "Fixture Co",
    ...overrides,
  });
}

/**
 * Order via orderRepo.create — live column names (userId, stateId, status
 * lowercase). Writes the consumer_orderproduct line item too when productId
 * is given, and stamps orderProductId on the result.
 */
async function seedOrder({ customerId, stateId, productId, ...overrides }) {
  return orderRepo.create({
    userId: customerId,
    stateId,
    productId,
    quantity: overrides.quantity ?? 1000,
    price: overrides.price ?? "100.00",
    status: overrides.status ?? "pending",
    // Remaining NOT NULLs with no DB default, mirroring what placeOrder
    // itself supplies (services/order.service.js:386-405).
    releaseType: overrides.deliveryType ?? "pickup",
    releaseStatus: "pending",
    orderType: "regular",
    truckExited: false,
    truckEntered: false,
    overpaymentFlagged: false,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  });
}

/**
 * Fleet truck via truckRepo (consumer_fleettruck + sman.truck_extras).
 * consumer_fleettruck is Django's table: most document/contact columns are
 * NOT NULL with no default, so they are all supplied (empty where a value
 * carries no meaning for a test fixture).
 */
async function seedFleetTruck(overrides = {}) {
  return truckRepo.create({
    plateNumber: `FLT${uniq()}`.toUpperCase(),
    driverName: "Fixture Driver",
    driverPhone: "+2348010000000",
    driverAltPhone: "",
    motorBoyName: "",
    motorBoyPhone1: "",
    motorBoyPhone2: "",
    spareDriverName: "",
    spareDriverPhone: "",
    passportPhoto: "",
    driversLicenseDoc: "",
    insuranceCertDoc: "",
    vehiclePapersDoc: "",
    incidents: "",
    chassisNumber: `CH${uniq()}`.toUpperCase(),
    truckMake: "Actros",
    truckStatus: "Active",
    isActive: true,
    maxCapacity: 45000,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  });
}

/**
 * LPG station via lpgStationRepo (consumer_lpgplant + sman.lpg_station_extras).
 * The live plant table's NOT NULLs carry no DB default (Django fills them
 * app-side), so they are all supplied here. `status` maps to is_active
 * ("Active" <-> true) inside the repo; address-ish fields land on the extras
 * row. With { cylinders: [...] }, stocks sman.lpg_station_cylinders too.
 */
async function seedLpgStation({ cylinders, ...overrides } = {}) {
  const station = await lpgStationRepo.create({
    name: `Test LPG Station ${uniq()}`,
    code: `L${uniq()}`.slice(0, 10),
    pricePerKg: "1200",
    capacityKg: "100000.00",
    lowStockThresholdKg: "0.00",
    bulkThresholdKg: "0.00",
    nextReceiptSeq: 1,
    status: "Active",
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  });
  if (Array.isArray(cylinders) && cylinders.length > 0) {
    await lpgStationRepo.setCylinders(station.id, cylinders);
  }
  return station;
}

module.exports = {
  uniq,
  now,
  seedState,
  seedProduct,
  seedPrice,
  seedDepot,
  seedPfi,
  seedCustomer,
  seedOrder,
  seedFleetTruck,
  seedLpgStation,
};
