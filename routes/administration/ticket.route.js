const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const validate = require("../../middleware/validate");
const misc = require("../../schemas/misc.schema");
const {
  getTickets,
  getTicketByIdOrCode,
  redeemTicket,
} = require("../../controllers/administration/ticket.controller");

router.get("/", verifyStaff, validate({ query: misc.listTickets }), getTickets);
router.get("/:idOrCode", verifyStaff, validate({ params: misc.ticketIdOrCode }), getTicketByIdOrCode);
router.post("/:idOrCode/redeem", verifyStaff, validate({ params: misc.ticketIdOrCode }), redeemTicket);

module.exports = router;
