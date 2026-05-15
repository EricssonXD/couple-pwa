-- Migration: 0024_pet_disable_xpboost.sql
-- Phase 5 follow-up — disable buff_xpboost in the shop.
--
-- v1 has no XP system, so the buff cannot be activated (the service
-- throws `buff_xp_unavailable`). Listing it in the shop only confuses
-- users — they can buy something that does nothing. We hide it until
-- XP lands, at which point a future migration flips it back on.
--
-- The migration is idempotent (UPDATE).

UPDATE pet_shop_item
SET enabled = false
WHERE id = 'buff_xpboost';
