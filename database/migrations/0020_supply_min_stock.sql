-- Pflegebedarf: minimum house stock per product; at or below it the product has to be reordered.

ALTER TABLE carecore_care_supply_products
  ADD COLUMN IF NOT EXISTS min_stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (min_stock_quantity >= 0);
