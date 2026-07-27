const { dailyReportRepo, staffRepo } = require("../repositories");
const { emitEvent } = require("./events");

const UNIQUE_VIOLATION = "23505";
const isUniqueViolation = (err) =>
  err?.code === UNIQUE_VIOLATION || err?.cause?.code === UNIQUE_VIOLATION;

// price_bands is the source of truth when present; the scalar avgPrice and
// litresSold are derived from it so both representations always agree.
const deriveFromBands = (priceBands, fallbackLitres, fallbackPrice) => {
  if (!Array.isArray(priceBands) || priceBands.length === 0) {
    return {
      litresSold: Number(fallbackLitres || 0),
      avgPrice: Number(fallbackPrice || 0),
      totalSalesAmount: Number(fallbackLitres || 0) * Number(fallbackPrice || 0),
    };
  }
  let litres = 0;
  let value = 0;
  for (const band of priceBands) {
    const bandLitres = Number(band.litres || 0);
    const bandPrice = Number(band.price || 0);
    litres += bandLitres;
    value += bandLitres * bandPrice;
  }
  return {
    litresSold: litres,
    avgPrice: litres > 0 ? value / litres : 0,
    totalSalesAmount: value,
  };
};

const submitReport = async (data, { actor }) => {
  const derived = deriveFromBands(data.priceBands, data.litresSold, data.avgPrice);

  try {
    const report = await dailyReportRepo.create({
      ...data,
      litresSold: derived.litresSold.toFixed(2),
      avgPrice: derived.avgPrice.toFixed(2),
      totalSalesAmount: derived.totalSalesAmount.toFixed(2),
      status: "submitted",
      submittedBy: actor?.id || null,
      submittedByName: actor?.name || "",
    });

    emitEvent("daily_report.submitted", {
      actor,
      entityType: "daily_report",
      entityId: report.id,
      location: report.location,
      reportDate: report.reportDate,
    });

    return { success: true, report };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return {
        success: false,
        duplicate: true,
        message: "A report for this date, location and PFI has already been submitted by you",
      };
    }
    throw err;
  }
};

/**
 * Corrections while still under review: only the submitter's own submitted
 * (not yet reviewed) report can change, and derived fields are recomputed.
 */
const amendReport = async (id, data, { actor }) => {
  const report = await dailyReportRepo.findById(id);
  if (!report) return { success: false, notFound: true, message: "Report not found" };
  if (report.status !== "submitted") {
    return { success: false, message: `A ${report.status} report can no longer be amended` };
  }
  if (actor?.id && report.submittedBy && report.submittedBy !== actor.id) {
    return { success: false, forbidden: true, message: "Only the submitter can amend this report" };
  }

  const merged = { ...report, ...data };
  const derived = deriveFromBands(merged.priceBands, merged.litresSold, merged.avgPrice);

  const updated = await dailyReportRepo.update(id, {
    ...data,
    litresSold: derived.litresSold.toFixed(2),
    avgPrice: derived.avgPrice.toFixed(2),
    totalSalesAmount: derived.totalSalesAmount.toFixed(2),
  });

  emitEvent("daily_report.amended", {
    actor,
    entityType: "daily_report",
    entityId: id,
  });

  return { success: true, report: updated };
};

const reviewReport = async (id, { approve, comment = "" }, { actor }) => {
  const report = await dailyReportRepo.findById(id);
  if (!report) return { success: false, notFound: true, message: "Report not found" };
  if (report.status !== "submitted") {
    return { success: false, message: `Report is already ${report.status}` };
  }
  // A manager cannot approve their own report.
  if (actor?.id && report.submittedBy === actor.id) {
    return { success: false, forbidden: true, message: "You cannot review your own report" };
  }

  const status = approve ? "approved" : "rejected";
  const updated = await dailyReportRepo.update(id, {
    status,
    reviewedBy: actor?.id || null,
    reviewedByName: actor?.name || "",
    reviewedAt: new Date(),
    reviewComment: comment,
  });

  const submitter = report.submittedBy ? await staffRepo.findById(report.submittedBy) : null;

  emitEvent(`daily_report.${status}`, {
    actor,
    entityType: "daily_report",
    entityId: id,
    report: updated,
    comment,
    submitterPhone: submitter?.phoneNumber || "",
  });

  return { success: true, report: updated };
};

module.exports = { submitReport, amendReport, reviewReport, deriveFromBands };
