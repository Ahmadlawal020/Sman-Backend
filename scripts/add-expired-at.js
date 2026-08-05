require("dotenv").config();
const { db } = require("../db");
const { sql } = require("drizzle-orm");

(async () => {
  try {
    // Check if expired_at already exists on dangote_order_requests
    const check1 = await db.execute(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'dangote_order_requests' AND column_name = 'expired_at'
    `);
    if (check1.length === 0) {
      await db.execute(sql`ALTER TABLE "dangote_order_requests" ADD COLUMN "expired_at" timestamp with time zone`);
      console.log("✅ Added expired_at to dangote_order_requests");
    } else {
      console.log("⏭️  expired_at already exists on dangote_order_requests");
    }

    // Check if expired_at already exists on lpg_order_requests
    const check2 = await db.execute(sql`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'lpg_order_requests' AND column_name = 'expired_at'
    `);
    if (check2.length === 0) {
      await db.execute(sql`ALTER TABLE "lpg_order_requests" ADD COLUMN "expired_at" timestamp with time zone`);
      console.log("✅ Added expired_at to lpg_order_requests");
    } else {
      console.log("⏭️  expired_at already exists on lpg_order_requests");
    }

    console.log("Done!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();
