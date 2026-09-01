-- Kolofon RLS Policies Setup
-- Run this in Supabase SQL Editor to enable admin access

-- ===== PRODUCTS TABLE POLICIES =====

-- Allow public read access (for storefront)
CREATE POLICY "Allow public read products"
ON products 
FOR SELECT 
USING (true);

-- Allow authenticated users to insert products (admin)
CREATE POLICY "Allow authenticated insert products"
ON products 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update products (admin)
CREATE POLICY "Allow authenticated update products"
ON products 
FOR UPDATE 
USING (auth.role() = 'authenticated');

-- Allow authenticated users to delete products (admin)
CREATE POLICY "Allow authenticated delete products"
ON products 
FOR DELETE 
USING (auth.role() = 'authenticated');

-- ===== ORDERS TABLE POLICIES =====

-- Allow authenticated users to read orders (admin)
CREATE POLICY "Allow authenticated read orders"
ON orders 
FOR SELECT 
USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert orders (checkout)
CREATE POLICY "Allow authenticated insert orders"
ON orders 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

-- Allow authenticated users to update orders (admin)
CREATE POLICY "Allow authenticated update orders"
ON orders 
FOR UPDATE 
USING (auth.role() = 'authenticated');

-- Allow authenticated users to delete orders (admin)
CREATE POLICY "Allow authenticated delete orders"
ON orders 
FOR DELETE 
USING (auth.role() = 'authenticated');
