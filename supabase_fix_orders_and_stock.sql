-- Kolofon: two faults found after the first order actually saved.
--
-- 1. Stock never decremented. payment-callback calls
--       supabase.rpc('decrement_stock', { row_id, quantity_sold })
--    but that function does not exist (PGRST202). The call has no error
--    handling, so it failed silently on every order.
--
-- 2. The admin panel showed no orders. RLS is enabled on the table, but no
--    SELECT policy was ever created, so a signed-in admin matches nothing.
--    The callback writes with the service role, which bypasses RLS - which is
--    why orders save and email fine while remaining invisible in the panel.


-- ===== 1. Stock decrement =====

CREATE OR REPLACE FUNCTION decrement_stock(row_id BIGINT, quantity_sold INT)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE products
  SET "stockQuantity" = GREATEST(COALESCE("stockQuantity", 0) - quantity_sold, 0)
  WHERE id = row_id;
$$;

-- Postgres makes new functions executable by everyone by default. Only the
-- payment callback should ever move stock: without this, anyone holding the
-- public key could call it and empty the shop's inventory.
REVOKE ALL ON FUNCTION decrement_stock(BIGINT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrement_stock(BIGINT, INT) FROM anon;
REVOKE ALL ON FUNCTION decrement_stock(BIGINT, INT) FROM authenticated;
GRANT EXECUTE ON FUNCTION decrement_stock(BIGINT, INT) TO service_role;


-- ===== 2. Let the signed-in admin see and manage orders =====
-- Scoped to the authenticated role only. There is deliberately no policy for
-- anon: orders hold customer names, addresses and emails, and must stay
-- unreadable to the public key that ships in the site's JavaScript.

DROP POLICY IF EXISTS "Allow authenticated read orders" ON orders;
CREATE POLICY "Allow authenticated read orders"
ON orders FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Allow authenticated update orders" ON orders;
CREATE POLICY "Allow authenticated update orders"
ON orders FOR UPDATE TO authenticated
USING (true);

DROP POLICY IF EXISTS "Allow authenticated delete orders" ON orders;
CREATE POLICY "Allow authenticated delete orders"
ON orders FOR DELETE TO authenticated
USING (true);

NOTIFY pgrst, 'reload schema';
