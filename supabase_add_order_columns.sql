-- Kolofon: add the columns payment-callback writes but the orders table lacks.
--
-- Symptom: a real payment succeeded, PensoPay called back, the signature
-- verified, and then the insert failed with
--   PGRST204 "Could not find the 'order_id' column of 'orders' in the schema cache"
-- so the order was never recorded and stock never decremented.
--
-- The table already has: id, created_at, email, total, items, customer_details.
-- These four are the ones the callback also writes.

ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pensopay_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'new';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT;

-- PensoPay sends payment.authorized and payment.captured separately. The
-- callback inserts on the first and then finds the row again with
--   .eq('order_id', resource.order_id)
-- to mark it captured, so this index serves that lookup and also prevents the
-- same order id being stored twice.
CREATE UNIQUE INDEX IF NOT EXISTS orders_order_id_key ON orders (order_id);

-- PostgREST caches the schema; nudge it so the new columns are visible at once
-- rather than after its next automatic reload.
NOTIFY pgrst, 'reload schema';
