const express = require("express");
const router = express.Router();
const verifyAdmin = require("../../middleware/verifyAdmin");
const {
  getTickets,
  getTicketByIdOrCode,
  redeemTicket,
} = require("../../controllers/administration/ticket.controller");

router.get("/", verifyAdmin, getTickets);
router.get("/:idOrCode", verifyAdmin, getTicketByIdOrCode);
router.post("/:idOrCode/redeem", verifyAdmin, redeemTicket);

module.exports = router;
