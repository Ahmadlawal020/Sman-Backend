const { defineConfig } = require("drizzle-kit");

module.exports = defineConfig({
  schema: "./db/schema/*",
  // db/migrations/ was quarantined to db/migrations.legacy-neon — it describes
  // the old clean-room schema, not soroman_db. Only db:check reads this config
  // now; db:generate/migrate/push are disabled in package.json.
  out: "./db/migrations.legacy-neon",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
