-- Expense categories become a GL chart of accounts, and each expense line
-- carries the invoice figures a payment schedule needs (TIN, invoice number,
-- ex-VAT / VAT / WHT) alongside the amount actually paid.
--
-- `amount` keeps its meaning throughout: the money that left the bank. Every
-- total in the app already reads it, so the new columns sit beside it and none
-- of them feed a total.

ALTER TABLE "expense_categories" ADD COLUMN "gl_code" varchar(20);
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "gl_group" varchar(40);
--> statement-breakpoint
ALTER TABLE "expense_categories" ADD COLUMN "gl_subgroup" varchar(60) DEFAULT '' NOT NULL;
--> statement-breakpoint
-- Partial, so the per-PFI system categories (no GL code) are unaffected.
CREATE UNIQUE INDEX "expense_categories_gl_code_idx" ON "expense_categories" ("gl_code") WHERE "gl_code" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "pfi_expenses" ADD COLUMN "tin_number" varchar(30) DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "invoice_number" varchar(100) DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "amount_ex_vat" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "vat_amount" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "invoice_amount" numeric(15, 2);
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "wht_deduction" numeric(15, 2) DEFAULT '0' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pfi_expenses" ADD COLUMN "bank_code" varchar(20) DEFAULT '' NOT NULL;
--> statement-breakpoint

-- The chart of accounts. Idempotent, and a general category that already
-- carries one of these names is adopted into the chart rather than duplicated.
INSERT INTO "expense_categories" ("name", "gl_code", "gl_group", "gl_subgroup", "pfi_id", "is_system_category")
VALUES
  -- 1. PFI / product related costs (direct)
  ('Fuel costs', '5010', 'pfi_direct', '', NULL, false),
  ('Freight & Shipping costs', '5020', 'pfi_direct', '', NULL, false),
  ('Throughput Expenses', '5030', 'pfi_direct', '', NULL, false),
  ('Jetty fee', '5040', 'pfi_direct', '', NULL, false),
  ('Agency & Clearing expenses', '5050', 'pfi_direct', '', NULL, false),
  ('Inspection services expenses', '5060', 'pfi_direct', '', NULL, false),
  ('Marine Insurance', '5070', 'pfi_direct', '', NULL, false),
  ('Repairs and Maintenance of Property, Plant and Equipment (Direct)', '5080', 'pfi_direct', '', NULL, false),
  ('Repairs and Maintenance of Right Of Use Assets (Direct)', '5090', 'pfi_direct', '', NULL, false),
  ('Impairment of Property, Plant and Equipment (Direct)', '5100', 'pfi_direct', '', NULL, false),
  ('Employee benefits expense (Direct)', '5110', 'pfi_direct', '', NULL, false),
  ('Depreciation and Amortization Expenses (Direct)', '5120', 'pfi_direct', '', NULL, false),
  ('Other Direct Costs', '5900', 'pfi_direct', '', NULL, false),

  -- 2. Administrative expenses
  ('Staff Salaries, Wages & Other Related Staff Costs', '6110', 'administrative', 'Staff & Employee', NULL, false),
  ('Salary & Related Staff Costs', '6120', 'administrative', 'Staff & Employee', NULL, false),
  ('Medical Expenses', '6130', 'administrative', 'Staff & Employee', NULL, false),
  ('Recruitment Charges', '6140', 'administrative', 'Staff & Employee', NULL, false),
  ('Training Cost', '6150', 'administrative', 'Staff & Employee', NULL, false),
  ('Directors Expenses', '6160', 'administrative', 'Staff & Employee', NULL, false),

  ('Repair & Maintenance', '6210', 'administrative', 'Office & General', NULL, false),
  ('Printing and Stationery Costs', '6220', 'administrative', 'Office & General', NULL, false),
  ('Postage and other telephone expenses', '6230', 'administrative', 'Office & General', NULL, false),
  ('Electricity and Lighting', '6240', 'administrative', 'Office & General', NULL, false),
  ('Rent, Rate and Insurance', '6250', 'administrative', 'Office & General', NULL, false),
  ('General Insurance Expenses', '6260', 'administrative', 'Office & General', NULL, false),
  ('Other General Administrative Expenses', '6290', 'administrative', 'Office & General', NULL, false),

  ('Management Fees', '6310', 'administrative', 'Professional & Corporate', NULL, false),
  ('Auditors Remuneration', '6320', 'administrative', 'Professional & Corporate', NULL, false),
  ('Consultancy Fees', '6330', 'administrative', 'Professional & Corporate', NULL, false),
  ('Legal & Other Professional Fees', '6340', 'administrative', 'Professional & Corporate', NULL, false),
  ('Corporate Fees', '6350', 'administrative', 'Professional & Corporate', NULL, false),

  ('License and Permit', '6410', 'administrative', 'Government & Regulatory', NULL, false),
  ('Statutory Fees, Rates & Taxes', '6420', 'administrative', 'Government & Regulatory', NULL, false),
  ('Fines and Penalty', '6430', 'administrative', 'Government & Regulatory', NULL, false),

  ('Bank charges', '6510', 'administrative', 'Finance', NULL, false),
  ('Interest-Bank Loan', '6520', 'administrative', 'Finance', NULL, false),

  ('Depreciation and Amortization Expenses (Indirect)', '6610', 'administrative', 'Depreciation & Impairment', NULL, false),
  ('Impairment of Property, Plant and Equipment (Indirect)', '6620', 'administrative', 'Depreciation & Impairment', NULL, false),
  ('Impairment On Trade and Other Receivables (Indirect)', '6630', 'administrative', 'Depreciation & Impairment', NULL, false),
  ('Bad Debts', '6640', 'administrative', 'Depreciation & Impairment', NULL, false),

  ('Transport and Travelling Expenses', '6710', 'administrative', 'Other', NULL, false),
  ('Fuel, Oil and Lubricants', '6720', 'administrative', 'Other', NULL, false),
  ('Corporate Social Responsibility', '6730', 'administrative', 'Other', NULL, false),

  -- 3. Depot / warehouse
  ('Depot/Warehouse Operating Costs', '7010', 'depot', '', NULL, false),

  -- 4. Sales & distribution
  ('Advertisement and Promotion', '7510', 'sales_distribution', '', NULL, false),
  ('Other Selling & Distribution Expenses', '7590', 'sales_distribution', '', NULL, false),

  -- 5. Income and other receipts. Seeded so the chart is complete; the expense
  -- form never offers them and the API refuses to book a cost against one.
  ('Sales Revenue', '4010', 'income', '', NULL, false),
  ('Miscellaneous Income', '4020', 'income', '', NULL, false),
  ('Insurance Claims', '4030', 'income', '', NULL, false),
  ('Government Grant', '4040', 'income', '', NULL, false),
  ('Profit from Disposal of Non-current assets', '4050', 'income', '', NULL, false),
  ('Rental Income', '4060', 'income', '', NULL, false),
  ('Dividend Income', '4070', 'income', '', NULL, false),
  ('Share of profit from Investment in Associate', '4080', 'income', '', NULL, false),
  ('Share of profit from Investment in Joint Venture', '4090', 'income', '', NULL, false)
ON CONFLICT ("name") DO UPDATE SET
  gl_code = EXCLUDED.gl_code,
  gl_group = EXCLUDED.gl_group,
  gl_subgroup = EXCLUDED.gl_subgroup,
  updated_at = NOW()
WHERE "expense_categories".pfi_id IS NULL;
