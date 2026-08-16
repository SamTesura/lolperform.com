-- Distinct first-three build archetypes with win rate, JSON array or NULL.
-- Win rate is conditioned on games that completed three items, which removes
-- most of the survivorship bias that keeps raw per-item win rates unpublished.
ALTER TABLE builds ADD COLUMN core_options TEXT;
