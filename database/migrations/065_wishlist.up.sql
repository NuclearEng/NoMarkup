-- 065_wishlist — buyer "dream item" wishlist + price-alert ceiling.
--
-- A wishlist item is a standing want: a free-text keyword (e.g. "4 wheeler"),
-- an optional category, and a max-price ceiling ("notify me if one is available
-- at or below $500"). When a new marketplace listing goes ACTIVE and matches a
-- wishlist item (keyword in title, price <= max_price_cents, optional category),
-- the gateway fans a notification out to the wishlist owner — see
-- gateway/internal/handler/wishlist.go (NotifyWishlistMatches) wired into the
-- CreateListing path.
--
-- Conventions (CLAUDE.md §5): snake_case plural table, uuid id, {singular}_id
-- FKs, UTC created_at, soft-delete via deleted_at, money is BIGINT cents, every
-- FK + filter column indexed. gen_random_uuid() matches the rest of the schema
-- (no uuid_v7 generator is installed in this DB).

CREATE TABLE IF NOT EXISTS wishlist_items (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Free-text "what I'm hunting for". Matched case-insensitively against a
    -- listing's title (and description) on create. Capped in the handler.
    keyword         text        NOT NULL,
    -- Optional category narrowing. NULL = match any category.
    category_id     uuid        REFERENCES service_categories(id) ON DELETE SET NULL,
    -- "Notify me if available at or below this price." Integer cents, > 0.
    max_price_cents bigint      NOT NULL CHECK (max_price_cents > 0),
    created_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz
);

-- Owner-scoped reads (list my wishlist) — the hot path. Partial on the live
-- (non-deleted) rows.
CREATE INDEX IF NOT EXISTS idx_wishlist_items_user
    ON wishlist_items (user_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- FK index for the optional category facet.
CREATE INDEX IF NOT EXISTS idx_wishlist_items_category
    ON wishlist_items (category_id)
    WHERE deleted_at IS NULL;
