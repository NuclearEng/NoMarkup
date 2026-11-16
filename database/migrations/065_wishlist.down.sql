-- Down: drop the wishlist table and its indexes.
DROP INDEX IF EXISTS idx_wishlist_items_category;
DROP INDEX IF EXISTS idx_wishlist_items_user;
DROP TABLE IF EXISTS wishlist_items;
