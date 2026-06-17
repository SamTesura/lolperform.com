/**
 * Pipeline entrypoint. P0 placeholder — the detect → crawl → aggregate → load
 * chain is implemented in P2/P3.
 */
import { loadConfig } from './config.js';

function main(): void {
  const config = loadConfig();
  console.info(
    `[pipeline] scaffold ready. regions=${config.regions.join(',')} ` +
      `playersPerDivision=${config.playersPerDivision} matchesPerPlayer=${config.matchesPerPlayer}`,
  );
  console.info('[pipeline] crawl/aggregate/load land in P2/P3.');
}

main();
