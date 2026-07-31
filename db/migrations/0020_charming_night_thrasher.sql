-- No-op: dangote_order_requests was renamed to dangote_delivery_orders in
-- 0019 (data preserved), so there is nothing to drop. This migration exists
-- only to keep the drizzle journal/snapshot sequence consistent with the
-- two-step generation used to avoid the interactive rename prompt.
SELECT 1;
