/**
 * Every customer-facing string the engine can say, in one reviewable module.
 * The wording IS the product on this channel, so: functions of their
 * variables, no logic beyond formatting, and a snapshot test pins each one —
 * an accidental rewording shows up as a diff in review, not in a customer's
 * chat.
 *
 * Tone (agreed): warm professional, light emoji. This channel moves millions
 * of naira; friendly, never flippant.
 *
 * Support contact arrives as a variable (from SUPPORT_PHONE config) so no
 * real phone number lives in code.
 */

const naira = (amount) =>
  "₦" + Number(amount || 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });

const litres = (qty) => `${Number(qty || 0).toLocaleString("en-NG")} L`;

// ---------------------------------------------------------------- identify

const identifyPrompt = () =>
  "Welcome to Soroman Energy 👋\n\nWhat name should we put on your orders?";

const identifyInvalidName = () =>
  "That doesn't look like a name we can put on an order. Please send your full name — letters only, 2 to 60 characters.";

const welcome = (name) =>
  `Thanks, ${name} — you're all set. 🎉\n\nWhat would you like to do?`;

// -------------------------------------------------------------------- menu

const menuGreeting = (name) =>
  name ? `Hello ${name} 👋 What would you like to do?` : "Hello 👋 What would you like to do?";

const menuButtons = () => ({
  order: "Place an order",
  prices: "Check prices",
  track: "Track my order",
});

const reorderRow = (lastOrder) => ({
  title: "Reorder last order",
  description: `${litres(lastOrder.quantity)} ${lastOrder.productName} — ${lastOrder.depotName}`,
});

const noStockAnywhere = () =>
  "We're sorry — every depot is out of stock right now. 😔 Please check back shortly; stock updates through the day.";

const inactiveCustomer = (supportPhone) =>
  `Your account isn't active at the moment, so we can't take an order here. Please call us on ${supportPhone} and we'll get you sorted.`;

const helpText = () =>
  "Here's what you can type at any time:\n\n" +
  "• *menu* — back to the main menu\n" +
  "• *track* — status of your last order\n" +
  "• *cancel* — discard the order you're building\n" +
  "• *help* — this message\n\n" +
  "To order, just tap *Place an order* from the menu.";

// -------------------------------------------------------------------- track

const trackStatus = (order) => {
  const lines = {
    Pending: "We're waiting for your payment. Once it lands, we'll confirm here.",
    Paid: "Payment received ✅ Your order is with our team for release.",
    Released: "Released ✅ Your truck can proceed to the depot gate.",
    Loading: "Loading is underway at the depot. 🚛",
    Completed: "Completed ✅ Thank you for choosing Soroman!",
    Cancelled: "This order was cancelled.",
  };
  return (
    `Order *${order.orderNumber}* — ${litres(order.quantity)} ${order.productName}, ${order.depotName}.\n\n` +
    `Status: *${order.status}*\n${lines[order.status] || ""}`
  );
};

const trackNoOrder = () =>
  "You don't have any orders with us yet. Tap *Place an order* from the menu to get started.";

// ------------------------------------------------------------------- prices

const pricesHeader = () => "Today's prices 📋\n";

const pricesDepotLine = (depotName, productParts) => `\n*${depotName}*: ${productParts.join(", ")}`;

const pricesProductPart = (productName, price) => `${productName} ${naira(price)}/L`;

const pricesFooter = () => "\n\nTap *Place an order* from the menu when you're ready.";

// -------------------------------------------------------------------- depot

const depotPrompt = () => "Which depot would you like to order from?";

const depotListButton = () => "Choose a depot";

const moreRow = () => ({ title: "More depots ▸", description: "See the next page" });

const depotUnavailable = () =>
  "That depot isn't available right now. Here are the ones that are:";

// ------------------------------------------------------------------ product

const productPrompt = (depotName) => `What are you buying at ${depotName}?`;

const productListButton = () => "Choose a product";

const productRowDescription = (price, stock) => `${naira(price)}/L · ${litres(stock)} available`;

const productUnavailable = (depotName) =>
  `That product isn't available at ${depotName} right now. Here's what is:`;

// ----------------------------------------------------------------- quantity

const quantityPrompt = (productName, depotName, stock) =>
  `How many litres of ${productName}?\n\nWe have ${litres(stock)} at ${depotName} right now.`;

const quantityInvalid = () =>
  'Please send the quantity as a number of litres — for example *30000* or *30,000*.';

const quantityBelowMin = (min) =>
  `Our minimum order is ${litres(min)}. How many litres would you like?`;

const quantityAboveCap = (cap) =>
  `That looks like a typo — we can take up to ${litres(cap)} in one order. How many litres would you like?`;

const quantityOverStock = (stock, depotName) =>
  `We have ${litres(stock)} at ${depotName} right now — would you like that instead?`;

const overStockButtons = (stock) => ({
  takeStock: `Yes — ${Number(stock).toLocaleString("en-NG")} L`,
  changeDepot: "Change depot",
  menu: "Back to menu",
});

// ------------------------------------------------------------------ collect

const collectPrompt = () => "How would you like to collect it?";

const collectButtons = () => ({ pickup: "Pickup (my truck)", delivery: "Delivery to me" });

// ---------------------------------------------------------------- logistics

const platePrompt = (index, count, litresForTruck) =>
  count > 1
    ? `This order needs ${count} trucks. 🚛\n\nTruck ${index} of ${count} (${litres(litresForTruck)}) — what's the plate number?`
    : "What's the plate number of the truck coming for pickup?";

const plateInvalid = () =>
  "That plate number doesn't look right. Please send it like *ABC-123-XY* (letters and numbers).";

const addressPrompt = () => "Where should we deliver to? Please send the full address.";

const addressInvalid = () =>
  "That address looks too short. Please send the full delivery address, including the area and state.";

// ------------------------------------------------------------------ confirm

const confirmSummary = ({ productName, quantity, depotName, deliveryType, unitPrice, total, plates, address }) => {
  const collect =
    deliveryType === "delivery"
      ? `Delivery to: ${address}`
      : `Pickup — truck${plates.length > 1 ? "s" : ""}: ${plates.join(", ")}`;
  return (
    "Here's your order 🧾\n\n" +
    `• ${litres(quantity)} ${productName}\n` +
    `• Depot: ${depotName}\n` +
    `• ${collect}\n` +
    `• Price: ${naira(unitPrice)}/L\n` +
    `• *Total: ${naira(total)}*\n\n` +
    "Confirm to get your invoice and payment details."
  );
};

const confirmWalletHint = (balance) =>
  `💡 You have ${naira(balance)} in your wallet — enough to cover this. Confirm and we'll pay from it instantly, no transfer needed.`;

const confirmOutdated = () =>
  "Heads up — your order changed after that summary was sent, so that button is out of date. Here's the current one:";

const confirmButtons = () => ({ confirm: "Confirm ✅", edit: "Edit", cancel: "Cancel" });

const editPrompt = () => "What would you like to change?";

const editListButton = () => "Change something";

const editRows = () => ({
  depot: { title: "Depot" },
  product: { title: "Product" },
  quantity: { title: "Quantity" },
  collect: { title: "Collection" },
});

const orderPending = () =>
  "One moment — we're creating your order… ⏳";

// ----------------------------------------------------- order outcome & payment

const orderCreated = (order) =>
  `Order *${order.orderNumber}* is in ✅\n\n` +
  `*Total: ${naira(order.totalAmount)}*\n\n` +
  `Pay by bank transfer to your dedicated account:\n` +
  `${order.virtualAccountBank}\n` +
  `*${order.virtualAccountNumber}*\n` +
  `${order.virtualAccountName}\n\n` +
  "Payment is confirmed automatically — we'll message you here the moment it lands.";

const orderPaidWallet = (order) =>
  `Order *${order.orderNumber}* is in — and already paid ✅\n\n` +
  `${naira(order.totalAmount)} was covered by your wallet balance, so there's nothing to transfer. ` +
  "Your loading ticket is being prepared, and we'll keep you posted here at every step.";

const portalManageHint = (portalUrl) =>
  `Need to change a truck or plate later? Manage this order at ${portalUrl}`;

const invoiceCaption = (orderNumber) => `Invoice for order ${orderNumber}`;

const orderFailedStock = (stock, depotName) =>
  stock > 0
    ? `So sorry — someone beat you to part of that stock. 😔 We now have ${litres(stock)} at ${depotName}. How many litres would you like?`
    : `So sorry — that stock was just bought out at ${depotName}. 😔 Let's pick another depot:`;

const orderFailedGeneric = (supportPhone) =>
  `Something went wrong creating your order — your money has NOT been taken. 🙏 Please try again in a moment, or call us on ${supportPhone}.`;

const awaitPaymentNudge = (order) =>
  `We're waiting on your transfer for order *${order.orderNumber}* — ${naira(order.totalAmount)} to ${order.virtualAccountBank} *${order.virtualAccountNumber}*.\n\nType *track* any time for status.`;

const paymentConfirmed = (order) =>
  `Payment received ✅ Order *${order.orderNumber}* is confirmed.\n\nWe'll keep you posted here at every step — release, loading and completion.`;

// ---------------------------------------------------------- session & misc

const cancelled = () =>
  "No problem — that order has been discarded. 🗑️ Nothing was charged.\n\nWhat would you like to do?";

const expiredResume = ({ productName, quantity, depotName }) => {
  const summary = [quantity && litres(quantity), productName, depotName && `from ${depotName}`]
    .filter(Boolean)
    .join(" ");
  return `Welcome back 👋 That order timed out${summary ? ` — you were ordering ${summary}` : ""}. Want to pick up where you left off?`;
};

const resumeButtons = () => ({ resume: "Continue order", startover: "Start over" });

const unsupportedType = () =>
  "I can only read text and taps for now — voice notes and photos don't reach me. 🙏";

const threeStrikes = () =>
  "Let's take it from the top — that might be easier. 😅";

const threeStrikesButtons = () => ({ menu: "Back to menu", retry: "Try again" });

module.exports = {
  naira,
  litres,
  identifyPrompt,
  identifyInvalidName,
  welcome,
  menuGreeting,
  menuButtons,
  reorderRow,
  noStockAnywhere,
  inactiveCustomer,
  helpText,
  trackStatus,
  trackNoOrder,
  pricesHeader,
  pricesDepotLine,
  pricesProductPart,
  pricesFooter,
  depotPrompt,
  depotListButton,
  moreRow,
  depotUnavailable,
  productPrompt,
  productListButton,
  productRowDescription,
  productUnavailable,
  quantityPrompt,
  quantityInvalid,
  quantityBelowMin,
  quantityAboveCap,
  quantityOverStock,
  overStockButtons,
  collectPrompt,
  collectButtons,
  platePrompt,
  plateInvalid,
  addressPrompt,
  addressInvalid,
  confirmSummary,
  confirmWalletHint,
  confirmOutdated,
  confirmButtons,
  orderPaidWallet,
  editPrompt,
  editListButton,
  editRows,
  orderPending,
  orderCreated,
  portalManageHint,
  invoiceCaption,
  orderFailedStock,
  orderFailedGeneric,
  awaitPaymentNudge,
  paymentConfirmed,
  cancelled,
  expiredResume,
  resumeButtons,
  unsupportedType,
  threeStrikes,
  threeStrikesButtons,
};
