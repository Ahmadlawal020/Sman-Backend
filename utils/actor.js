// The acting principal for audit/event attribution, from verifyStaff's
// req.user. Email stands in for a display name — it's what the token has.
const staffActor = (req) => ({
  type: "staff",
  id: req.user?.id || null,
  name: req.user?.email || "",
});

module.exports = { staffActor };
