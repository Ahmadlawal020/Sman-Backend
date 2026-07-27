const ROLE_MAP = {
  0: "super_admin",
  1: "admin",
  2: "finance",
  3: "truck_sales",
  4: "ticketing",
  // The gate has two posts: one confirms a truck ENTERED the facility to load,
  // one confirms it EXITED with its load. Replaces the single "security" role.
  5: "security_entry",
  6: "transport",
  7: "release",
  8: "audit",
  9: "sales_manager",
  10: "product_manager",
  11: "lpg_dashboard",
  12: "lpg_plants",
  13: "lpg_stock",
  14: "lpg_sales",
  15: "commissions",
  16: "commission_officer",
  17: "dispatch",
  18: "it_compliance",
  19: "security_exit",
};

const mapRolesToBackend = (numericRoles) => {
  return numericRoles
    .map((r) => ROLE_MAP[r])
    .filter(Boolean);
};

module.exports = { ROLE_MAP, mapRolesToBackend };
