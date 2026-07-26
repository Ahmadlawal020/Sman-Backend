const asyncHandler = require("express-async-handler");
const { pfiRepo, depotRepo, productRepo, staffRepo, orderRepo } = require("../../repositories");

const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
};

const resolveOfficerName = async (id) => {
  if (!id) return "";
  try {
    const admin = await staffRepo.findById(id);
    if (!admin) return "";
    return `${admin.firstName || ""} ${admin.surname || ""}`.trim();
  } catch {
    return "";
  }
};

const getPfis = asyncHandler(async (req, res) => {
  const { search, status, page = 1, limit = 100, location } = req.query;

  const result = await pfiRepo.findAll({ search, status, location, page, limit });

  res.json({ success: true, data: result });
});

const getPfiById = asyncHandler(async (req, res) => {
  const pfi = await pfiRepo.findById(req.params.id);

  if (!pfi) {
    return res.status(404).json({ success: false, message: "PFI not found" });
  }

  res.json({ success: true, data: { pfi } });
});

const createPfi = asyncHandler(async (req, res) => {
  const pfi_number = req.body.pfi_number || req.body.pfiNumber;
  const description = req.body.description || "";
  const pfi_date = req.body.pfi_date || req.body.pfiDate;
  const location_id = req.body.location_id || req.body.locationId;
  const product_id = req.body.product_id || req.body.productId;
  const starting_qty_litres = req.body.starting_qty_litres ?? req.body.startingQtyLitres;
  const qty_volume_mt = req.body.qty_volume_mt ?? req.body.qtyVolumeMt;
  const unit_price = req.body.unit_price ?? req.body.unitPrice;
  const audit_officer = req.body.audit_officer || req.body.auditOfficerId;
  const product_officer = req.body.product_officer || req.body.productOfficerId;
  const it_compliance_officer = req.body.it_compliance_officer || req.body.itComplianceOfficerId;
  const security_exit_officer = req.body.security_exit_officer || req.body.securityExitOfficerId;
  const commission_officer = req.body.commission_officer || req.body.commissionOfficerId;
  const sales_manager = req.body.sales_manager || req.body.salesManagerId;
  const vessel_broker = req.body.vessel_broker || req.body.vesselBroker;
  const vessel_name = req.body.vessel_name || req.body.vesselName;
  const surveyor_name = req.body.surveyor_name || req.body.surveyorName;
  const surveyor_phone = req.body.surveyor_phone || req.body.surveyorPhone;

  if (!pfi_number) {
    return res.status(400).json({ success: false, message: "PFI number is required" });
  }

  const existing = await pfiRepo.findByNumber(String(pfi_number).trim());
  if (existing) {
    return res.status(409).json({ success: false, message: "A PFI with this number already exists" });
  }

  let location_name = "";
  if (location_id) {
    const depot = await depotRepo.findById(location_id);
    if (depot) location_name = depot.name;
  }

  let product_name = "";
  let product_unit = "Litres";
  if (product_id) {
    const prod = await productRepo.findById(product_id);
    if (prod) {
      product_name = prod.name;
      product_unit = prod.unit || "Litres";
    }
  }

  const officerDefs = [
    { field: "audit_officer", idKey: "auditOfficerId", nameKey: "auditOfficerName" },
    { field: "product_officer", idKey: "productOfficerId", nameKey: "productOfficerName" },
    { field: "it_compliance_officer", idKey: "itComplianceOfficerId", nameKey: "itComplianceOfficerName" },
    { field: "security_exit_officer", idKey: "securityExitOfficerId", nameKey: "securityExitOfficerName" },
    { field: "commission_officer", idKey: "commissionOfficerId", nameKey: "commissionOfficerName" },
    { field: "sales_manager", idKey: "salesManagerId", nameKey: "salesManagerName" },
  ];

  const officerNames = {};
  for (const { field, idKey, nameKey } of officerDefs) {
    const val = req.body[field] || req.body[idKey] || req.body[`${field}_id`];
    officerNames[nameKey] = await resolveOfficerName(val);
  }

  const pfi = await pfiRepo.create({
    pfiNumber: String(pfi_number).trim(),
    description: description || "",
    pfiDate: parseDate(pfi_date),
    locationId: location_id ? (parseInt(location_id, 10) || location_id) : null,
    locationName: location_name,
    productId: product_id ? (parseInt(product_id, 10) || product_id) : null,
    productName: product_name,
    productUnit: product_unit,
    startingQtyLitres: Number(starting_qty_litres) || 0,
    qtyVolumeMt: Number(qty_volume_mt) || 0,
    unitPrice: String(Number(unit_price) || 0),
    auditOfficerId: audit_officer ? (parseInt(audit_officer, 10) || audit_officer) : null,
    productOfficerId: product_officer ? (parseInt(product_officer, 10) || product_officer) : null,
    itComplianceOfficerId: it_compliance_officer ? (parseInt(it_compliance_officer, 10) || it_compliance_officer) : null,
    securityExitOfficerId: security_exit_officer ? (parseInt(security_exit_officer, 10) || security_exit_officer) : null,
    commissionOfficerId: commission_officer ? (parseInt(commission_officer, 10) || commission_officer) : null,
    salesManagerId: sales_manager ? (parseInt(sales_manager, 10) || sales_manager) : null,
    ...officerNames,
    vesselBroker: vessel_broker || "",
    vesselName: vessel_name || "",
    surveyorName: surveyor_name || "",
    surveyorPhone: surveyor_phone || "",
  });

  res.status(201).json({ success: true, message: "PFI created successfully", data: { pfi } });
});

const updatePfi = asyncHandler(async (req, res) => {
  const pfi = await pfiRepo.findById(req.params.id);

  if (!pfi) {
    return res.status(404).json({ success: false, message: "PFI not found" });
  }

  const allowedFields = [
    "pfi_number", "description", "pfi_date", "status", "starting_qty_litres",
    "qty_volume_mt", "sold_qty_litres", "total_amount", "unit_price",
    "vessel_broker", "vessel_name", "surveyor_name", "surveyor_phone",
    "closure_date", "total_inflow", "closure_bank", "purchase_cost",
    "aggregate_expenses", "closure_handler", "closure_remarks",
  ];

  const updateData = {};
  for (const field of allowedFields) {
    const camelKey = field.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    const value = req.body[field] !== undefined ? req.body[field] : req.body[camelKey];
    if (value !== undefined) {
      if (field === "pfi_date") {
        updateData.pfiDate = parseDate(value);
      } else if (field === "closure_date") {
        updateData.closureDate = parseDate(value);
      } else {
        updateData[camelKey] = value;
      }
    }
  }

  if (req.body.location_id || req.body.locationId) {
    const locId = req.body.location_id || req.body.locationId;
    updateData.locationId = locId;
    const depot = await depotRepo.findById(locId);
    if (depot) updateData.locationName = depot.name;
  }

  if (req.body.product_id || req.body.productId) {
    const prodId = req.body.product_id || req.body.productId;
    updateData.productId = prodId;
    const prod = await productRepo.findById(prodId);
    if (prod) {
      updateData.productName = prod.name;
      updateData.productUnit = prod.unit || "Litres";
    }
  }

  const officerDefs = [
    { field: "audit_officer", idKey: "auditOfficerId", nameKey: "auditOfficerName" },
    { field: "product_officer", idKey: "productOfficerId", nameKey: "productOfficerName" },
    { field: "it_compliance_officer", idKey: "itComplianceOfficerId", nameKey: "itComplianceOfficerName" },
    { field: "security_exit_officer", idKey: "securityExitOfficerId", nameKey: "securityExitOfficerName" },
    { field: "commission_officer", idKey: "commissionOfficerId", nameKey: "commissionOfficerName" },
    { field: "sales_manager", idKey: "salesManagerId", nameKey: "salesManagerName" },
  ];

  for (const { field, idKey, nameKey } of officerDefs) {
    const val =
      req.body[idKey] !== undefined
        ? req.body[idKey]
        : req.body[`${field}_id`] !== undefined
        ? req.body[`${field}_id`]
        : req.body[field] !== undefined
        ? req.body[field]
        : undefined;

    if (val !== undefined) {
      const numericVal = val ? (parseInt(val, 10) || val) : null;
      updateData[idKey] = numericVal;
      updateData[nameKey] = await resolveOfficerName(val);
    }
  }

  const updated = await pfiRepo.update(pfi.id, updateData);

  res.json({ success: true, message: "PFI updated successfully", data: { pfi: updated } });
});

const deletePfi = asyncHandler(async (req, res) => {
  const pfi = await pfiRepo.findById(req.params.id);

  if (!pfi) {
    return res.status(404).json({ success: false, message: "PFI not found" });
  }

  const orderCount = await orderRepo.countByPfi(pfi.id);
  if (orderCount > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete PFI: it is referenced by ${orderCount} order(s)`,
    });
  }

  await pfiRepo.deleteById(pfi.id);

  res.json({ success: true, message: "PFI deleted successfully" });
});

module.exports = { getPfis, getPfiById, createPfi, updatePfi, deletePfi };
