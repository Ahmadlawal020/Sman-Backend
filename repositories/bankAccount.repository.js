const { client } = require("../db");

let tableInitialized = false;

async function ensureTableExists() {
  if (tableInitialized) return;
  try {
    await client`
      CREATE TABLE IF NOT EXISTS bank_accounts (
        id SERIAL PRIMARY KEY,
        bank_name VARCHAR(100) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_number VARCHAR(50) NOT NULL,
        bank_code VARCHAR(50) DEFAULT '',
        branch_name VARCHAR(150) DEFAULT '',
        currency VARCHAR(10) DEFAULT 'NGN' NOT NULL,
        status VARCHAR(20) DEFAULT 'Active' NOT NULL,
        is_default BOOLEAN DEFAULT false NOT NULL,
        depot_ids JSONB DEFAULT '[]'::jsonb NOT NULL,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
      );
    `;
    tableInitialized = true;
  } catch (err) {
    console.error("Failed to initialize bank_accounts table:", err.message);
  }
}

async function attachDepotsToAccount(account) {
  if (!account) return account;
  const depotIds = Array.isArray(account.depotIds)
    ? account.depotIds
    : typeof account.depot_ids === "string"
    ? JSON.parse(account.depot_ids)
    : account.depot_ids || [];

  const numericIds = depotIds
    .map((id) => Number(id))
    .filter((id) => !isNaN(id) && id > 0);

  let depots = [];
  if (numericIds.length > 0) {
    try {
      const rows = await client`
        SELECT id, name, code, city, state, country, status
        FROM depots
        WHERE id = ANY(${numericIds})
      `;
      depots = rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        city: r.city,
        state: r.state,
        country: r.country,
        status: r.status,
      }));
    } catch (e) {
      console.error("Failed to fetch depots for bank account:", e.message);
    }
  }

  return {
    id: account.id,
    bankName: account.bank_name || account.bankName,
    accountName: account.account_name || account.accountName,
    accountNumber: account.account_number || account.accountNumber,
    bankCode: account.bank_code || account.bankCode || "",
    branchName: account.branch_name || account.branchName || "",
    currency: account.currency || "NGN",
    status: account.status || "Active",
    isDefault: Boolean(account.is_default ?? account.isDefault),
    depotIds: numericIds,
    depots,
    notes: account.notes || "",
    createdAt: account.created_at || account.createdAt,
    updatedAt: account.updated_at || account.updatedAt,
  };
}

const bankAccountRepo = {
  async findAll({ search, status, depotId } = {}) {
    await ensureTableExists();

    let rows = await client`
      SELECT * FROM bank_accounts
      ORDER BY is_default DESC, id DESC
    `;

    let results = await Promise.all(rows.map(attachDepotsToAccount));

    if (search) {
      const query = search.toLowerCase().trim();
      results = results.filter((acc) => {
        const inBank = acc.bankName?.toLowerCase().includes(query);
        const inName = acc.accountName?.toLowerCase().includes(query);
        const inNumber = acc.accountNumber?.toLowerCase().includes(query);
        const inDepot = acc.depots?.some((d) =>
          d.name?.toLowerCase().includes(query) || d.code?.toLowerCase().includes(query)
        );
        return inBank || inName || inNumber || inDepot;
      });
    }

    if (status) {
      results = results.filter((acc) => acc.status === status);
    }

    if (depotId) {
      const targetId = Number(depotId);
      results = results.filter((acc) => acc.depotIds.includes(targetId));
    }

    return results;
  },

  async findById(id) {
    await ensureTableExists();
    const numericId = Number(id);
    if (isNaN(numericId)) return null;

    const rows = await client`
      SELECT * FROM bank_accounts
      WHERE id = ${numericId}
      LIMIT 1
    `;

    if (rows.length === 0) return null;
    return await attachDepotsToAccount(rows[0]);
  },

  async create(data) {
    await ensureTableExists();

    const {
      bankName,
      accountName,
      accountNumber,
      bankCode = "",
      branchName = "",
      currency = "NGN",
      status = "Active",
      isDefault = false,
      depotIds = [],
      notes = "",
    } = data;

    const jsonDepotIds = JSON.stringify(
      Array.isArray(depotIds) ? depotIds.map((i) => Number(i)).filter((i) => !isNaN(i)) : []
    );

    if (isDefault) {
      await client`UPDATE bank_accounts SET is_default = false`;
    }

    const rows = await client`
      INSERT INTO bank_accounts (
        bank_name,
        account_name,
        account_number,
        bank_code,
        branch_name,
        currency,
        status,
        is_default,
        depot_ids,
        notes,
        created_at,
        updated_at
      ) VALUES (
        ${bankName},
        ${accountName},
        ${accountNumber},
        ${bankCode},
        ${branchName},
        ${currency},
        ${status},
        ${isDefault},
        ${jsonDepotIds}::jsonb,
        ${notes},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    return await attachDepotsToAccount(rows[0]);
  },

  async update(id, data) {
    await ensureTableExists();
    const numericId = Number(id);
    if (isNaN(numericId)) return null;

    const existing = await this.findById(numericId);
    if (!existing) return null;

    const bankName = data.bankName !== undefined ? data.bankName : existing.bankName;
    const accountName = data.accountName !== undefined ? data.accountName : existing.accountName;
    const accountNumber = data.accountNumber !== undefined ? data.accountNumber : existing.accountNumber;
    const bankCode = data.bankCode !== undefined ? data.bankCode : existing.bankCode;
    const branchName = data.branchName !== undefined ? data.branchName : existing.branchName;
    const currency = data.currency !== undefined ? data.currency : existing.currency;
    const status = data.status !== undefined ? data.status : existing.status;
    const isDefault = data.isDefault !== undefined ? Boolean(data.isDefault) : existing.isDefault;
    const depotIds = data.depotIds !== undefined ? data.depotIds : existing.depotIds;
    const notes = data.notes !== undefined ? data.notes : existing.notes;

    const jsonDepotIds = JSON.stringify(
      Array.isArray(depotIds) ? depotIds.map((i) => Number(i)).filter((i) => !isNaN(i)) : []
    );

    if (isDefault && !existing.isDefault) {
      await client`UPDATE bank_accounts SET is_default = false WHERE id != ${numericId}`;
    }

    const rows = await client`
      UPDATE bank_accounts
      SET
        bank_name = ${bankName},
        account_name = ${accountName},
        account_number = ${accountNumber},
        bank_code = ${bankCode},
        branch_name = ${branchName},
        currency = ${currency},
        status = ${status},
        is_default = ${isDefault},
        depot_ids = ${jsonDepotIds}::jsonb,
        notes = ${notes},
        updated_at = NOW()
      WHERE id = ${numericId}
      RETURNING *
    `;

    if (rows.length === 0) return null;
    return await attachDepotsToAccount(rows[0]);
  },

  async delete(id) {
    await ensureTableExists();
    const numericId = Number(id);
    if (isNaN(numericId)) return false;

    const rows = await client`
      DELETE FROM bank_accounts
      WHERE id = ${numericId}
      RETURNING id
    `;
    return rows.length > 0;
  },
};

module.exports = bankAccountRepo;
