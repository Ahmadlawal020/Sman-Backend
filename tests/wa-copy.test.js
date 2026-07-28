/**
 * Snapshot-pins every customer-facing string the engine can say. The wording
 * IS the product on this channel: an intentional change updates the snapshot
 * file in the same commit and gets reviewed; an accidental one fails here
 * instead of reaching a customer.
 *
 * Regenerate deliberately with:
 *   npm test -- --test-update-snapshots   (or node --test --test-update-snapshots tests/wa-copy.test.js)
 */
const { test } = require("node:test");

const copy = require("../whatsapp/copy");

const ORDER = {
  orderNumber: "SOR-1042",
  quantity: 30000,
  productName: "PMS",
  depotName: "Warri",
  status: "Released",
  totalAmount: 25500000,
  virtualAccountBank: "Wema Bank",
  virtualAccountNumber: "9930001111",
  virtualAccountName: "SOROMANNIGERI/ AO",
};

test("every copy string, pinned", (t) => {
  const SUPPORT = "+234-800-SOROMAN";

  t.assert.snapshot({
    identifyPrompt: copy.identifyPrompt(),
    identifyInvalidName: copy.identifyInvalidName(),
    welcome: copy.welcome("Ada Obi"),

    menuGreetingNamed: copy.menuGreeting("Ada Obi"),
    menuGreetingAnonymous: copy.menuGreeting(null),
    menuButtons: copy.menuButtons(),
    reorderRow: copy.reorderRow(ORDER),
    noStockAnywhere: copy.noStockAnywhere(),
    inactiveCustomer: copy.inactiveCustomer(SUPPORT),
    helpText: copy.helpText(),

    trackPending: copy.trackStatus({ ...ORDER, status: "Pending" }),
    trackPaid: copy.trackStatus({ ...ORDER, status: "Paid" }),
    trackReleased: copy.trackStatus({ ...ORDER, status: "Released" }),
    trackLoading: copy.trackStatus({ ...ORDER, status: "Loading" }),
    trackCompleted: copy.trackStatus({ ...ORDER, status: "Completed" }),
    trackCancelled: copy.trackStatus({ ...ORDER, status: "Cancelled" }),
    trackNoOrder: copy.trackNoOrder(),

    pricesExample:
      copy.pricesHeader() +
      copy.pricesDepotLine("Warri", [copy.pricesProductPart("PMS", 850), copy.pricesProductPart("AGO", 1020)]) +
      copy.pricesFooter(),

    depotPrompt: copy.depotPrompt(),
    depotListButton: copy.depotListButton(),
    moreRow: copy.moreRow(),
    depotUnavailable: copy.depotUnavailable(),

    productPrompt: copy.productPrompt("Warri"),
    productListButton: copy.productListButton(),
    productRowDescription: copy.productRowDescription(850, 120000),
    productUnavailable: copy.productUnavailable("Warri"),

    quantityPrompt: copy.quantityPrompt("PMS", "Warri", 120000),
    quantityInvalid: copy.quantityInvalid(),
    quantityBelowMin: copy.quantityBelowMin(1000),
    quantityAboveCap: copy.quantityAboveCap(1000000),
    quantityOverStock: copy.quantityOverStock(45000, "Warri"),
    overStockButtons: copy.overStockButtons(45000),

    collectPrompt: copy.collectPrompt(),
    collectButtons: copy.collectButtons(),

    plateSingle: copy.platePrompt(1, 1, 30000),
    plateMulti: copy.platePrompt(2, 3, 50000),
    plateInvalid: copy.plateInvalid(),
    addressPrompt: copy.addressPrompt(),
    addressInvalid: copy.addressInvalid(),

    confirmPickup: copy.confirmSummary({
      productName: "PMS",
      quantity: 30000,
      depotName: "Warri",
      deliveryType: "pickup",
      unitPrice: 850,
      total: 25500000,
      plates: ["ABC-123-XY"],
    }),
    confirmDelivery: copy.confirmSummary({
      productName: "AGO",
      quantity: 10000,
      depotName: "Lagos",
      deliveryType: "delivery",
      unitPrice: 1020,
      total: 10200000,
      plates: [],
      address: "14 Airport Road, Warri, Delta",
    }),
    confirmButtons: copy.confirmButtons(),
    editPrompt: copy.editPrompt(),
    editListButton: copy.editListButton(),
    editRows: copy.editRows(),
    orderPending: copy.orderPending(),

    orderCreated: copy.orderCreated(ORDER),
    portalManageHint: copy.portalManageHint("https://portal.example/orders/1042"),
    invoiceCaption: copy.invoiceCaption("SOR-1042"),
    orderFailedStockSome: copy.orderFailedStock(45000, "Warri"),
    orderFailedStockNone: copy.orderFailedStock(0, "Warri"),
    orderFailedGeneric: copy.orderFailedGeneric(SUPPORT),
    awaitPaymentNudge: copy.awaitPaymentNudge(ORDER),
    paymentConfirmed: copy.paymentConfirmed(ORDER),

    cancelled: copy.cancelled(),
    expiredResumeFull: copy.expiredResume({ productName: "PMS", quantity: 30000, depotName: "Warri" }),
    expiredResumeBare: copy.expiredResume({}),
    resumeButtons: copy.resumeButtons(),
    unsupportedType: copy.unsupportedType(),
    threeStrikes: copy.threeStrikes(),
    threeStrikesButtons: copy.threeStrikesButtons(),
  });
});
