const asyncHandler = require("express-async-handler");
const { deliveryCustomerRepo, deliveryNoteRepo } = require("../../repositories");

const createDeliveryCustomer = asyncHandler(async (req, res) => {
  const {
    customerType, name, phoneNumber, altPhoneNumber, email,
    homeAddress, officeAddress, passportPhoto,
    contactPerson, contactPersonPhone, stationAddress,
    tankCapacity, pumpCount, creditLimit, notes,
  } = req.body;

  if (!customerType || !["customer", "filling_station"].includes(customerType)) {
    return res.status(400).json({
      success: false,
      message: "Invalid or missing customerType. Must be 'customer' or 'filling_station'",
    });
  }

  if (!name || !phoneNumber) {
    return res.status(400).json({
      success: false,
      message: "Name and primary phone number are required",
    });
  }

  const customerCode = await deliveryCustomerRepo.generateCustomerCode(customerType);

  const customerData = {
    customerType,
    customerCode,
    name,
    phoneNumber,
    altPhoneNumber: altPhoneNumber || "",
    email: email || "",
    creditLimit: String(creditLimit || 0),
    notes: notes || "",
    createdBy: req.user ? req.user.id : null,
  };

  if (customerType === "customer") {
    customerData.homeAddress = homeAddress || "";
    customerData.officeAddress = officeAddress || "";
    customerData.passportPhoto = passportPhoto || "";
  } else if (customerType === "filling_station") {
    customerData.contactPerson = contactPerson || "";
    customerData.contactPersonPhone = contactPersonPhone || "";
    customerData.stationAddress = stationAddress || officeAddress || "";
    customerData.tankCapacity = tankCapacity || 0;
    customerData.pumpCount = pumpCount || 1;
  }

  const newCustomer = await deliveryCustomerRepo.create(customerData);

  res.status(201).json({
    success: true,
    message: `${customerType === "filling_station" ? "Filling Station" : "Customer"} created successfully`,
    data: newCustomer,
  });
});

const getDeliveryCustomers = asyncHandler(async (req, res) => {
  const { type, search, status, page = 1, limit = 50 } = req.query;

  const result = await deliveryCustomerRepo.findAllWithSalesAggregation({
    type,
    search,
    status,
    page,
    limit,
  });

  res.json({ success: true, data: result });
});

const createDeliveryNote = asyncHandler(async (req, res) => {
  const { customerId, product, quantityDelivered, unit, driver, truck, depotOfLoading, deliveryAddress, remarks } = req.body;

  const customer = await deliveryCustomerRepo.findById(customerId);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Delivery Customer not found" });
  }

  const noteNumber = await deliveryNoteRepo.generateNoteNumber();

  const deliveryNote = await deliveryNoteRepo.create({
    deliveryNoteNumber: noteNumber,
    customerId: customer.id,
    customerTypeSnapshot: customer.customerType,
    deliveryAddress: deliveryAddress || customer.stationAddress || customer.homeAddress || "",
    contactPersonOnSite: {
      name: customer.customerType === "filling_station" ? customer.contactPerson : customer.name,
      phone: customer.customerType === "filling_station" ? customer.contactPersonPhone : customer.phoneNumber,
    },
    product,
    quantityDelivered,
    unit: unit || "Liters",
    driver: driver || {},
    truck: truck || {},
    depotOfLoading: depotOfLoading || "",
    remarks: remarks || "",
    createdBy: req.user ? req.user.id : null,
  });

  await deliveryCustomerRepo.update(customer.id, {
    lastTransactionDate: new Date(),
  });

  res.status(201).json({
    success: true,
    message: "Delivery Note created successfully",
    data: deliveryNote,
  });
});

const updateDeliveryCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = await deliveryCustomerRepo.findById(id);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Delivery customer not found" });
  }

  const updated = await deliveryCustomerRepo.update(id, req.body);

  res.json({
    success: true,
    message: "Customer updated successfully",
    data: updated,
  });
});

const deleteDeliveryCustomer = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const customer = await deliveryCustomerRepo.findById(id);
  if (!customer) {
    return res.status(404).json({ success: false, message: "Delivery customer not found" });
  }

  await deliveryCustomerRepo.deleteById(id);

  res.json({
    success: true,
    message: "Customer deleted successfully",
  });
});

module.exports = {
  createDeliveryCustomer,
  getDeliveryCustomers,
  createDeliveryNote,
  updateDeliveryCustomer,
  deleteDeliveryCustomer,
};
