const express = require("express");
const router = express.Router();
const verifyStaff = require("../../middleware/verifyStaff");
const {
  getTickets,
  getTicketByIdOrCode,
  redeemTicket,
} = require("../../controllers/administration/ticket.controller");

router.get("/", verifyStaff, getTickets);
router.get("/:idOrCode", verifyStaff, getTicketByIdOrCode);
router.post("/:idOrCode/redeem", verifyStaff, redeemTicket);

module.exports = router;
