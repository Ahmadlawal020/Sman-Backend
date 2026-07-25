const asyncHandler = require("express-async-handler");
const { deliveryInventoryRepo, pfiRepo, truckRepo } = require("../../repositories");

const getDeliveryInventory = asyncHandler(async (req, res) => {
  const { search, loading_status, truck_number, page = 1, limit = 500 } = req.query;

  const result = await deliveryInventoryRepo.findAll({
    search,
    loading_status,
    truck_number,
    page,
    limit,
  });

  res.json({ success: true, data: result });
});

const getDeliveryInventoryById = asyncHandler(async (req, res) => {
  const loading = await deliveryInventoryRepo.findById(req.params.id);
  if (!loading) {
    return res.status(404).json({ success: false, message: "Inventory record not found" });
  }
  res.json({ success: true, data: { loading } });
});

const createDeliveryInventory = asyncHandler(async (req, res) => {
  const {
    pfi, allocation_code, truck, truck_number, depot,
    customer, customer_name, quantity_allocated, rate,
    date_allocated, loading_status = "loaded", location, notes,
  } = req.body;

  let pfiObj = null;
  if (pfi) {
    pfiObj = await pfiRepo.findById(pfi);
  }

  let truckObj = null;
  if (truck) {
    truckObj = await truckRepo.findById(truck);
  }

  const inventoryRecord = await deliveryInventoryRepo.create({
    pfiId: pfi || null,
    pfiNumber: pfiObj ? pfiObj.pfiNumber : req.body.pfi_number || "",
    pfiProduct: pfiObj ? pfiObj.productName || pfiObj.productId : req.body.pfi_product || "",
    pfiLocation: pfiObj ? pfiObj.locationName || "" : "",
    allocationCode: allocation_code || null,
    truckId: truck || null,
    truckNumber: truck_number || (truckObj ? truckObj.plateNumber : ""),
    depot: depot || (pfiObj ? pfiObj.locationName : ""),
    customerId: customer || null,
    customerName: customer_name || "",
    quantityAllocated: Number(quantity_allocated) || 0,
    rate: String(Number(rate) || 0),
    dateAllocated: date_allocated || new Date().toISOString().split("T")[0],
    loadingStatus: loading_status,
    location: location || "",
    notes: notes || "",
    createdBy: req.user ? `${req.user.firstName} ${req.user.surname}` : "System",
  });

  res.status(201).json({
    success: true,
    message: "Delivery inventory record created",
    data: { inventoryRecord },
  });
});

const updateDeliveryInventory = asyncHandler(async (req, res) => {
  const record = await deliveryInventoryRepo.findById(req.params.id);
  if (!record) {
    return res.status(404).json({ success: false, message: "Inventory record not found" });
  }

  const updated = await deliveryInventoryRepo.update(record.id, req.body);

  res.json({
    success: true,
    message: "Delivery inventory record updated",
    data: { inventoryRecord: updated },
  });
});

const deleteDeliveryInventory = asyncHandler(async (req, res) => {
  const record = await deliveryInventoryRepo.deleteById(req.params.id);
  if (!record) {
    return res.status(404).json({ success: false, message: "Inventory record not found" });
  }
  res.json({ success: true, message: "Delivery inventory deleted" });
});

module.exports = {
  getDeliveryInventory,
  getDeliveryInventoryById,
  createDeliveryInventory,
  updateDeliveryInventory,
  deleteDeliveryInventory,
};
