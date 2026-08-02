const z = require("zod");
const { id, requiredString, enumOf, searchTerm, pagination, money } = require("./fields");

const LPG_STATION_STATUS = ["Active", "Maintenance", "High Capacity"];

const wholeCount = (label, { min = 0 } = {}) =>
  z.union(
    [
      z.number().finite(),
      z
        .string()
        .trim()
        .regex(/^-?\d+$/, `${label} must be a number`)
        .transform(Number),
    ],
    { error: (iss) => iss.input === undefined ? `${label} is required` : `${label} must be a number` }
  ).pipe(
    z
      .number()
      .int(`${label} must be a whole number`)
      .min(min, `${label} must be at least ${min}`)
  );

const cylinderEntry = z.object({
  cylinderSizeKg: wholeCount("Cylinder size (Kg)", { min: 1 }),
  quantity: wholeCount("Quantity", { min: 1 }),
});

const createLpgStation = z.object({
  name: requiredString("Station name", 255),
  code: requiredString("Station code", 50),
  address: requiredString("Address", 1000),
  city: requiredString("City", 100),
  state: requiredString("State", 100),
  country: requiredString("Country", 100),
  postcode: requiredString("Postcode", 20),
  lpgCapacityKg: wholeCount("LPG capacity (Kg)", { min: 1 }),
  pricePerKg: money("Price per Kg", { min: 0 }).optional(),
  status: enumOf("Status", LPG_STATION_STATUS).optional(),
  establishedYear: requiredString("Established year", 10),
  staffIds: z.array(z.union([id("Staff id"), z.string(), z.number()])).optional(),
  cylinders: z.array(cylinderEntry).optional(),
});

const updateLpgStation = createLpgStation.partial();

const listLpgStations = pagination.extend({
  search: searchTerm,
  status: enumOf("Status", [...LPG_STATION_STATUS, "all"]).optional(),
});

const idParam = z.object({ id: id("LPG station id") });

module.exports = { createLpgStation, updateLpgStation, listLpgStations, idParam };
