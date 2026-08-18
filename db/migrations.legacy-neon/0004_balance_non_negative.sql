-- A customer wallet may never go negative.
--
-- The application now guards every debit in the WHERE clause, so this should
-- never fire. That is exactly why it is worth having: it is the backstop that
-- turns a future unguarded debit — a new code path, a hand-run UPDATE, a
-- migration script — into a loud failure instead of quietly negative money.
--
-- Safe to add: verified 0 of 14 customers currently hold a negative balance.
--
-- NOTE FOR LATER: this encodes the assumption that every order is prepaid. If
-- a credit facility or deferred payment is ever introduced, dropping this
-- constraint is a deliberate migration and a deliberate decision, not an
-- obstacle to work around.
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_balance_non_negative" CHECK ("balance" >= 0);
