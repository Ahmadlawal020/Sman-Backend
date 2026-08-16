-- Two fields the PFI form needs and the table never had:
--
-- bl_qty_mt: the BL figure in MT, alongside the existing bl_qty_litres.
-- Nullable with no default, same convention as bl_qty_litres — "not entered
-- yet" must not read as a false zero.
--
-- credit_balance: a rebate, discount or claim credited back against the
-- cargo. Subtracted from total cost to get the grand total cost that profit
-- is computed against — see lib/pfiFinance.js. Defaults to 0, same as the
-- other PFI money columns (unit_price, total_amount).

ALTER TABLE "pfis" ADD COLUMN "bl_qty_mt" real;
--> statement-breakpoint
ALTER TABLE "pfis" ADD COLUMN "credit_balance" numeric(15, 2) DEFAULT '0';
