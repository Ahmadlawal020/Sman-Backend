const asyncHandler = require("express-async-handler");
const { ticketRepo, orderRepo } = require("../../repositories");

const getTickets = asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, search, status } = req.query;

  const result = await ticketRepo.findAll({ search, status, page, limit });

  res.json({ success: true, data: result });
});

const getTicketByIdOrCode = asyncHandler(async (req, res) => {
  const { idOrCode } = req.params;

  const ticket = await ticketRepo.findByIdOrCodeFull(idOrCode);

  if (!ticket) {
    return res
      .status(404)
      .json({ success: false, message: "Ticket not found" });
  }

  res.json({ success: true, data: { ticket } });
});

const redeemTicket = asyncHandler(async (req, res) => {
  const { idOrCode } = req.params;
  const adminId = req.user?.id || req.user?._id;

  if (!adminId) {
    return res
      .status(401)
      .json({ success: false, message: "Unauthorized admin ID" });
  }

  const ticket = await ticketRepo.findByIdOrCode(idOrCode);

  if (!ticket) {
    return res
      .status(404)
      .json({ success: false, message: "Ticket not found" });
  }

  if (ticket.status === "Redeemed") {
    return res
      .status(400)
      .json({ success: false, message: "Ticket has already been redeemed" });
  }

  await ticketRepo.update(ticket.id, {
    status: "Redeemed",
    redeemedAt: new Date(),
    redeemedBy: adminId,
  });

  // Mark order as completed if not already
  const order = await orderRepo.findById(ticket.orderId);
  if (order && order.status !== "Completed") {
    await orderRepo.update(order.id, { status: "Completed" });
  }

  const updatedTicket = await ticketRepo.findByIdOrCodeFull(ticket.id);

  res.json({
    success: true,
    message: "Ticket redeemed successfully",
    data: { ticket: updatedTicket },
  });
});

module.exports = {
  getTickets,
  getTicketByIdOrCode,
  redeemTicket,
};
