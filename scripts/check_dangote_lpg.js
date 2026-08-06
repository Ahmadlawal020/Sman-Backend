require("dotenv").config();
const { client } = require("../db");

async function check() {
  try {
    const dangote = await client`
      SELECT d.id, d.request_number, d.company_name, c.company_name AS cust_company, c.name AS cust_name 
      FROM dangote_order_requests d 
      LEFT JOIN customers c ON d.customer_id = c.id;
    `;
    console.log("Dangote orders in DB:", dangote.length);
    dangote.forEach(r => console.log(`Dangote ID ${r.id}: ${r.request_number} | Company: "${r.company_name || r.cust_company || r.cust_name}"`));

    const lpg = await client`
      SELECT l.id, l.request_number, c.company_name AS cust_company, c.name AS cust_name 
      FROM lpg_order_requests l 
      LEFT JOIN customers c ON l.customer_id = c.id;
    `;
    console.log("\nLPG orders in DB:", lpg.length);
    lpg.forEach(r => console.log(`LPG ID ${r.id}: ${r.request_number} | Company: "${r.cust_company || r.cust_name}"`));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    await client.end();
  }
}

check();
