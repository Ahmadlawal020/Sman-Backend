const { customerLicenseRepo, staffRepo } = require("../repositories");
const { emitEvent } = require("./events");

const reviewLicense = async (id, { approve, comment = "" }, { actor }) => {
  const license = await customerLicenseRepo.findById(id);
  if (!license) return { success: false, notFound: true, message: "License not found" };
  if (license.status !== "pending") {
    return { success: false, message: `License is already ${license.status}` };
  }

  const status = approve ? "approved" : "rejected";
  const updated = await customerLicenseRepo.update(id, {
    status,
    verifiedBy: actor?.id || null,
    verifiedByName: actor?.name || "",
    verifiedAt: new Date(),
    verificationComment: comment,
  });

  emitEvent(`license.${status}`, {
    actor,
    entityType: "customer_license",
    entityId: id,
    license: updated,
    comment,
  });

  return { success: true, license: updated };
};

module.exports = { reviewLicense };
