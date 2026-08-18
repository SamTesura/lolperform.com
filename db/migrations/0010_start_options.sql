-- Opening-buy options (first 30s of the timeline), JSON array or NULL. A 0:00
-- purchase is locked before the game develops — pre-outcome, so the win rate
-- is fair to publish. Populated only from matches whose timeline the crawl
-- sampled (1-in-5).
ALTER TABLE builds ADD COLUMN start_options TEXT;
