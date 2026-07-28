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

    stateListPrompt: copy.stateListPrompt(),
    stateListButton: copy.stateListButton(),
    stateRowDescriptionOne: copy.stateRowDescription(1),
    stateRowDescriptionMany: copy.stateRowDescription(4),
    changeStateRow: copy.changeStateRow(),
    depotPromptBare: copy.depotPrompt(),
    depotPromptRegion: copy.depotPrompt("Delta"),
    depotListButton: copy.depotListButton(),
    moreRow: copy.moreRow(),
    depotUnavailable: copy.depotUnavailable(),

    productPrompt: copy.productPrompt("Warri"),
    productListButton: copy.productListButton(),
    productRowDescription: copy.productRowDescription(850),
    productUnavailable: copy.productUnavailable("Warri"),

    quantityPrompt: copy.quantityPrompt("PMS", "Warri"),
    quantityInvalid: copy.quantityInvalid(),
    quantityBelowMin: copy.quantityBelowMin(1000),
    quantityAboveCap: copy.quantityAboveCap(1000000),
    quantityOverStock: copy.quantityOverStock("Warri"),
    overStockButtons: copy.overStockButtons(),

    collectPrompt: copy.collectPrompt(),
    collectButtons: copy.collectButtons(),

    truckCountPrompt: copy.truckCountPrompt(150000, 3, 10),
    truckCountInvalid: copy.truckCountInvalid(3, 10),
    truckLitresPrompt: copy.truckLitresPrompt(1, 3, 150000),
    truckLitresInvalid: copy.truckLitresInvalid(50000),
    lastTruckPrompt: copy.lastTruckPrompt(3, 30000),
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
      trucks: [{ quantity: 30000, plate: "ABC-123-XY" }],
    }),
    confirmPickupMultiTruck: copy.confirmSummary({
      productName: "PMS",
      quantity: 110000,
      depotName: "Warri",
      deliveryType: "pickup",
      unitPrice: 850,
      total: 93500000,
      trucks: [
        { quantity: 60000, plate: "AAA-111-AA" },
        { quantity: 50000, plate: "BBB-222-BB" },
      ],
    }),
    confirmDelivery: copy.confirmSummary({
      productName: "AGO",
      quantity: 10000,
      depotName: "Lagos",
      deliveryType: "delivery",
      unitPrice: 1020,
      total: 10200000,
      trucks: [],
      address: "14 Airport Road, Warri, Delta",
    }),
    confirmWalletHint: copy.confirmWalletHint(30000000),
    orderPaidWallet: copy.orderPaidWallet(ORDER),
    confirmOutdated: copy.confirmOutdated(),
    confirmButtons: copy.confirmButtons(),
    editPrompt: copy.editPrompt(),
    editListButton: copy.editListButton(),
    editRows: copy.editRows(),
    orderPending: copy.orderPending(),

    orderCreated: copy.orderCreated(ORDER),
    portalManageHint: copy.portalManageHint("https://portal.example/orders/1042"),
    invoiceCaption: copy.invoiceCaption("SOR-1042"),
    orderFailedStockSome: copy.orderFailedStock(true, "Warri"),
    orderFailedStockNone: copy.orderFailedStock(false, "Warri"),
    orderFailedGeneric: copy.orderFailedGeneric(SUPPORT),
    devPaidPrompt: copy.devPaidPrompt(),
    devPaidButton: copy.devPaidButton(),
    devSimulating: copy.devSimulating(),
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
