-- Dangote delivery products carry the canonical unit the app uses everywhere
-- ('litre' | 'kg'), so the catalog is the single source of truth for units.
UPDATE "products" SET "unit" = CASE WHEN "category" = 'LPG' THEN 'kg' ELSE 'litre' END
WHERE "product_type" = 'dangote';
