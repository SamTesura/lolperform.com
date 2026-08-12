-- Per-slot item alternatives and a dedicated boots row on the champion's own
-- build (see buildPathSchema.slotOptions / bootOptions). JSON columns,
-- nullable: vs-opponent rows and datasets written before this stay NULL.
-- Options carry popularity share and games, deliberately not win rates — an
-- item's "win rate" mostly measures having been winning long enough to buy it.
ALTER TABLE builds ADD COLUMN slot_options TEXT;
ALTER TABLE builds ADD COLUMN boot_options TEXT;
