const asyncHandler = require("express-async-handler");
const { deliveryCustomerRepo } = require("../../repositories");
const ledgerService = require("../../services/ledger.service");
const { sendServiceResult } = require("../../utils/serviceResult");
const { staffActor } = require("../../utils/actor");

// Two books, one engine: the delivery ledger covers every delivery customer;
// the station ledger is the same machinery scoped to customers of type
// filling_station, kept as a separate owner_type so each station's book —
// opening balance, purchases, payments, outstanding — stands on its own.

const makeBookController = ({ ownerType, requireStationType }) => {
  const resolveOwner = async (customerId) => {
    const customer = await deliveryCustomerRepo.findById(customerId);
    if (!customer) return { error: "Customer not found" };
    if (requireStationType && customer.customerType !== "filling_station") {
      return { error: "This customer is not a filling station" };
    }
    return { customer };
  };

  const getStatement = asyncHandler(async (req, res) => {
    const { customer, error } = await resolveOwner(req.params.id);
    if (error) return res.status(404).json({ success: false, message: error });

    const statement = await ledgerService.getStatement({
      ownerType,
      ownerId: customer.id,
      ...req.query,
    });
    res.json({ success: true, data: { customer: { id: customer.id, name: customer.name }, ...statement } });
  });

  const postEntry = asyncHandler(async (req, res) => {
    const { customer, error } = await resolveOwner(req.params.id);
    if (error) return res.status(404).json({ success: false, message: error });

    const actor = staffActor(req);
    const result = await ledgerService.postEntry({
      ownerType,
      ownerId: customer.id,
      ownerName: customer.name,
      ...req.body,
      recordedBy: actor.id,
      actor,
    });
    sendServiceResult(res, result, { successStatus: 201, message: "Ledger entry posted" });
  });

  const getBalance = asyncHandler(async (req, res) => {
    const { customer, error } = await resolveOwner(req.params.id);
    if (error) return res.status(404).json({ success: false, message: error });

    const account = await ledgerService.getAccount(ownerType, customer.id);
    res.json({
      success: true,
      data: {
        customer: { id: customer.id, name: customer.name },
        outstanding: account ? account.runningBalance : "0.00",
        account,
      },
    });
  });

  return { getStatement, postEntry, getBalance };
};

const deliveryLedger = makeBookController({ ownerType: "delivery_customer", requireStationType: false });
const stationLedger = makeBookController({ ownerType: "filling_station", requireStationType: true });

module.exports = { deliveryLedger, stationLedger };
