-- Which withholding rate was applied, kept beside the amount it produced.
--
-- The amount alone cannot be checked later: ₦5,000 withheld on ₦100,000 is
-- either a correct 5% or a mis-keyed 2%, and only the rate says which. NULL
-- means the amount was entered by hand rather than derived from a rate.
ALTER TABLE "pfi_expenses" ADD COLUMN "wht_rate" numeric(5, 2);
