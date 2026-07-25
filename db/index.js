const { drizzle } = require("drizzle-orm/postgres-js");
const { PgTimestamp } = require("drizzle-orm/pg-core");
const postgres = require("postgres");

const schema = require("./schema");
const relations = require("./relations");

// Patch Drizzle PgTimestamp to safely handle string, number, and Date inputs
PgTimestamp.prototype.mapToDriverValue = function (value) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "number") {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value?.toISOString === "function") {
    return value.toISOString();
  }
  return value;
};

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const client = postgres(connectionString);

const db = drizzle(client, {
  schema: {
    ...schema,
    ...relations,
  },
});

const testConnection = async () => {
  try {
    await client`SELECT 1`;
    console.log("Neon PostgreSQL connected successfully");
  } catch (err) {
    console.error("Neon PostgreSQL connection failed:", err.message);
    throw err;
  }
};

module.exports = { db, client, testConnection };
