-- BUY-59982: Regenerate search_vector for existing products with weighted FTS.
-- Previously search_vector used equal weights for title, brand, and category_path.
-- New ranking: title (A) > brand (B) > category_path (C), so accessories like
-- laptop skins/sleeves/decals are less likely to outrank actual laptops.

UPDATE products
SET search_vector =
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(brand, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(category_path, ' '), '')), 'C')
WHERE is_active = true
  AND search_vector IS DISTINCT FROM
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(brand, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(array_to_string(category_path, ' '), '')), 'C');
