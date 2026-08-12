-- Summoner spell pairs per champion's own build row, JSON, with pick share AND
-- win rate. Spells are locked in champion select — pre-lock like runes, unlike
-- items — so a per-pair win rate is a fair number to publish.
ALTER TABLE builds ADD COLUMN spell_options TEXT;
