-- TrioTect seed: menu items + inventory (stock-db)
INSERT INTO menu_items (id, name, description, price, category, is_active)
VALUES
  ('ITEM-BIRIYANI', 'Chicken Biriyani',  'Special Ramadan Iftar Biriyani', 450, 'main',     true),
  ('ITEM-KEBAB',    'Beef Kebab',        'Grilled beef kebab platter',      350, 'main',     true),
  ('ITEM-HALEEM',   'Chicken Haleem',    'Traditional iftar haleem',        300, 'main',     true),
  ('ITEM-JUICE',    'Mixed Fruit Juice', 'Fresh iftar juice',                80, 'beverage', true),
  ('ITEM-DATE',     'Medjool Dates',     'Premium dates for iftar break',   150, 'snack',    true),
  ('ITEM-SAMOSA',   'Vegetable Samosa',  'Crispy iftar samosa',              50, 'snack',    true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory (id, menu_item_id, current_stock, initial_stock, version_id)
SELECT gen_random_uuid()::text, id,
  CASE id
    WHEN 'ITEM-BIRIYANI' THEN 100  WHEN 'ITEM-KEBAB'   THEN 80
    WHEN 'ITEM-HALEEM'   THEN 60   WHEN 'ITEM-JUICE'   THEN 200
    WHEN 'ITEM-DATE'     THEN 150  WHEN 'ITEM-SAMOSA'  THEN 300
  END,
  CASE id
    WHEN 'ITEM-BIRIYANI' THEN 100  WHEN 'ITEM-KEBAB'   THEN 80
    WHEN 'ITEM-HALEEM'   THEN 60   WHEN 'ITEM-JUICE'   THEN 200
    WHEN 'ITEM-DATE'     THEN 150  WHEN 'ITEM-SAMOSA'  THEN 300
  END, 1
FROM menu_items
ON CONFLICT (menu_item_id) DO UPDATE
  SET current_stock = EXCLUDED.current_stock,
      initial_stock = EXCLUDED.initial_stock,
      version_id    = 1;

SELECT m.name, i.current_stock, m.price
FROM menu_items m JOIN inventory i ON i.menu_item_id = m.id
ORDER BY m.category, m.name;
