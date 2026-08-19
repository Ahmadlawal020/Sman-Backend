const crypto = require("crypto");
const { client } = require("../db");

/**
 * consumer_bankstatement / consumer_bankstatementline /
 * consumer_bankstatementcolumnmapping / consumer_bankacct are the live
 * tables — every query in this file used to target bank_statements,
 * bank_statement_lines, bank_statement_column_mappings and bank_accounts,
 * names from the old clean-room schema that don't exist live at all
 * (relation does not exist on every call). Column differences beyond the
 * rename, verified against the schema files, not guessed:
 *
 *  - consumer_bankstatement has row_count/new_line_count/duplicate_line_count
 *    (three counters), not row_count/duplicate_count (two) — and no
 *    period_start/period_end at all, dropped rather than invented.
 *  - consumer_bankstatementline.transaction_date/depositor_name, not
 *    txn_date/depositor. matched_payment_record_id (a real FK to
 *    consumer_orderpaymentrecord), not matched_deposit_id.
 *  - consumer_bankstatementcolumnmapping's column fields (date_column,
 *    amount_column, etc.) are varchar, not the JSONB sample_headers array
 *    the old table had — there is no live column for the sample header
 *    list at all, so it is accepted from the caller and not persisted
 *    (documented at upsertMapping, not silently dropped).
 *  - consumer_bankacct.name/acct_no, not account_name/account_number.
 */

/**
 * Stable fingerprint for a statement row.
 *
 * SHA-256 over date | bank reference | amount | depositor, truncated to 32
 * characters. Paired with a unique index on (bank_account_id, dedup_key), this
 * is what makes re-uploading an overlapping date range safe.
 */
function dedupKey({ txnDate, bankRef, amount, depositor }) {
  const day = new Date(txnDate).toISOString().slice(0, 10);
  const normalisedAmount = Number(amount).toFixed(2);
  const payload = [
    day,
    String(bankRef || "").trim().toLowerCase(),
    normalisedAmount,
    String(depositor || "").trim().toLowerCase(),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

const bankStatementRepo = {
  dedupKey,

  // ── Column mapping ────────────────────────────────────────────────────────

  async getMapping(bankAccountId) {
    const [row] = await client`
      SELECT * FROM consumer_bankstatementcolumnmapping
      WHERE bank_account_id = ${bankAccountId}
    `;
    return row || null;
  },

  /**
   * sampleHeaders (the header row's text, for the format-setup screen to show
   * on a later visit) has no live column — sample_file_name is the closest
   * thing consumer_bankstatementcolumnmapping has, and it holds a filename,
   * not a header list. Accepted here so the caller isn't rejected, not
   * persisted, since there's nowhere real to put it.
   */
  async upsertMapping(bankAccountId, m, createdById = null) {
    // varchar columns — stringify anything present, keep absent ones null
    // rather than the literal string "null"/"undefined".
    const str = (v) => (v === undefined || v === null ? null : String(v));
    const [row] = await client`
      INSERT INTO consumer_bankstatementcolumnmapping
        (bank_account_id, header_row, date_column, amount_column, credit_column,
         depositor_column, reference_column, narration_column, created_at, updated_at, created_by_id)
      VALUES (${bankAccountId}, ${m.headerRow ?? 0}, ${str(m.dateColumn)},
              ${str(m.amountColumn)}, ${str(m.creditColumn)},
              ${str(m.depositorColumn)}, ${str(m.referenceColumn)}, ${str(m.narrationColumn)},
              now(), now(), ${createdById})
      ON CONFLICT (bank_account_id) DO UPDATE SET
        header_row = EXCLUDED.header_row,
        date_column = EXCLUDED.date_column,
        amount_column = EXCLUDED.amount_column,
        credit_column = EXCLUDED.credit_column,
        depositor_column = EXCLUDED.depositor_column,
        reference_column = EXCLUDED.reference_column,
        narration_column = EXCLUDED.narration_column,
        updated_at = now()
      RETURNING *
    `;
    return row;
  },

  // ── Statements ────────────────────────────────────────────────────────────

  /**
   * Stores a parsed statement.
   *
   * Rows are deduplicated twice: against everything already held for the
   * account (by fingerprint *or* by the bank's own reference), and against the
   * rest of the incoming batch. A statement that yields no new rows is
   * rejected by the caller rather than stored empty.
   */
  async ingest({ bankAccountId, filename, uploadedBy, rows }) {
    const prepared = rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      dedup: dedupKey(r),
    }));

    const existing = await client`
      SELECT dedup_key, bank_ref FROM consumer_bankstatementline
      WHERE bank_account_id = ${bankAccountId}
    `;
    const seenKeys = new Set(existing.map((e) => e.dedup_key));
    const seenRefs = new Set(
      existing.map((e) => String(e.bank_ref || "").trim().toLowerCase()).filter(Boolean),
    );

    const fresh = [];
    let duplicates = 0;
    for (const r of prepared) {
      const ref = String(r.bankRef || "").trim().toLowerCase();
      if (seenKeys.has(r.dedup) || (ref && seenRefs.has(ref))) {
        duplicates++;
        continue;
      }
      seenKeys.add(r.dedup);
      if (ref) seenRefs.add(ref);
      fresh.push(r);
    }

    if (!fresh.length) return { added: 0, duplicates, statement: null };

    // This postgres driver binds timestamps as strings, not Date objects.
    const iso = (d) => new Date(d).toISOString();

    const [statement] = await client`
      INSERT INTO consumer_bankstatement
        (file, original_file_name, row_count, new_line_count, duplicate_line_count,
         uploaded_at, bank_account_id, uploaded_by_id)
      VALUES (${filename || ""}, ${filename || ""},
              ${prepared.length}, ${fresh.length}, ${duplicates},
              now(), ${bankAccountId}, ${uploadedBy ?? null})
      RETURNING *
    `;

    for (const r of fresh) {
      await client`
        INSERT INTO consumer_bankstatementline
          (bank_account_id, statement_id, transaction_date, amount, depositor_name, bank_ref,
           narration, raw_row, dedup_key, status, created_at)
        VALUES (${bankAccountId}, ${statement.id}, ${iso(r.txnDate).slice(0, 10)}, ${r.amount},
                ${r.depositor || ""}, ${r.bankRef || ""}, ${r.narration || ""},
                ${JSON.stringify(r.rawRow || [])}::jsonb, ${r.dedup}, 'UNMATCHED', now())
        ON CONFLICT (dedup_key, bank_account_id) DO NOTHING
      `;
    }

    return { added: fresh.length, duplicates, statement };
  },

  async listStatements(bankAccountId) {
    // A NULL account id means "all accounts" — avoids an empty SQL fragment.
    return client`
      SELECT s.*,
             b.bank_name, b.name AS account_name, b.acct_no AS account_number,
             (SELECT count(*) FROM consumer_bankstatementline l
               WHERE l.statement_id = s.id AND l.status = 'MATCHED')::int AS matched_count
      FROM consumer_bankstatement s
      JOIN consumer_bankacct b ON b.id = s.bank_account_id
      WHERE (${bankAccountId ?? null}::int IS NULL
             OR s.bank_account_id = ${bankAccountId ?? null}::int)
      ORDER BY s.uploaded_at DESC
    `;
  },

  /** Refuses to delete once any line has been matched — that is audit trail. */
  async deleteStatement(id) {
    const [{ matched }] = await client`
      SELECT count(*)::int AS matched FROM consumer_bankstatementline
      WHERE statement_id = ${id} AND status = 'MATCHED'
    `;
    if (matched > 0) return { deleted: false, matched };
    await client`DELETE FROM consumer_bankstatement WHERE id = ${id}`;
    return { deleted: true, matched: 0 };
  },

  // ── The matching pool ─────────────────────────────────────────────────────

  /**
   * Unmatched lines for an account.
   *
   * Amount search strips commas, so "150,000" and "150000" behave the same.
   */
  async searchUnmatched({ bankAccountId, q, limit = 50 }) {
    const term = String(q || "").trim();
    // Amount search ignores thousands separators, so "150,000" finds 150000.
    const numeric = term.replace(/,/g, "");
    const amount = numeric !== "" && !Number.isNaN(Number(numeric)) ? Number(numeric) : null;
    const like = term ? `%${term}%` : null;

    return client`
      SELECT * FROM consumer_bankstatementline
      WHERE bank_account_id = ${bankAccountId}
        AND status = 'UNMATCHED'
        AND (
          ${like}::text IS NULL
          OR depositor_name ILIKE ${like}::text
          OR bank_ref       ILIKE ${like}::text
          OR narration      ILIKE ${like}::text
          OR (${amount}::numeric IS NOT NULL AND amount = ${amount}::numeric)
        )
      ORDER BY transaction_date DESC
      LIMIT ${Math.min(Number(limit) || 50, 200)}
    `;
  },

  /**
   * Claims lines for a payment.
   *
   * The UPDATE filters on status = 'UNMATCHED', so two concurrent
   * confirmations can never claim the same deposit — the loser updates zero
   * rows and the caller sees a short count.
   */
  async markMatched({ lineIds, orderId, depositId, staffId }) {
    if (!Array.isArray(lineIds) || !lineIds.length) return { matched: 0 };
    const rows = await client`
      UPDATE consumer_bankstatementline
         SET status = 'MATCHED',
             matched_order_id = ${orderId ?? null},
             matched_payment_record_id = ${depositId ?? null},
             matched_by_id = ${staffId ?? null},
             matched_at = now()
       WHERE id = ANY(${lineIds}::int[])
         AND status = 'UNMATCHED'
      RETURNING id
    `;
    return { matched: rows.length, ids: rows.map((r) => r.id) };
  },
};

module.exports = bankStatementRepo;
