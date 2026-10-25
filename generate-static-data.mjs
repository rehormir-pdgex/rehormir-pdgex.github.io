import { writeFileSync, mkdirSync } from "fs";
import { getLeagueStandings, getEventDetail } from "./league-data.mjs";

const LEAGUE_SLUG = "pdgex-2026-9-sezona-91A25y";
const OUTPUT_DIR = "frontend/public/data";
const EVENTS_DIR = `${OUTPUT_DIR}/events`;

async function main() {
  mkdirSync(EVENTS_DIR, { recursive: true });

  console.log(`Fetching standings for ${LEAGUE_SLUG}...`);
  const standings = await getLeagueStandings(LEAGUE_SLUG);

  writeFileSync(
    `${OUTPUT_DIR}/standings.json`,
    JSON.stringify({ ...standings, lastUpdated: new Date().toISOString() }, null, 2)
  );
  console.log(`Wrote ${OUTPUT_DIR}/standings.json`);

  for (const event of standings.events) {
    console.log(`Fetching event detail for ${event.name}...`);
    const detail = await getEventDetail(event.shortId);
    writeFileSync(`${EVENTS_DIR}/${event.shortId}.json`, JSON.stringify(detail, null, 2));
  }
  console.log(`Wrote ${standings.events.length} event detail files.`);
  console.log("Done. Next: commit and push the frontend/public/data folder to publish this update.");
}

main().catch(err => {
  console.error("Failed to generate static data:", err);
  process.exit(1);
});