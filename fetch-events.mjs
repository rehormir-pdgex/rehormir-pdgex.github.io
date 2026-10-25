import { decode } from "turbo-stream";

function stringToStream(str) {
  const bytes = new TextEncoder().encode(str);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function decodeResponse(response) {
  const rawText = await response.text();
  const result = await decode(stringToStream(rawText));
  return result.value;
}

async function fetchEventList(leagueSlug) {
  const url = `https://udisc.com/leagues/${leagueSlug}/events-in-series.data?limit=20&_routes=routes%2Fleagues%2F%24slug%2Fevents-in-series`;
  const response = await fetch(url);
  const value = await decodeResponse(response);
  return value["routes/leagues/$slug/events-in-series"].data.leagueEvents.pastEvents;
}

async function resolveFullSlug(shortId) {
  const shortUrl = `https://udisc.com/events/${shortId}/leaderboard.data?round=1`;
  const response = await fetch(shortUrl);
  const rawText = await response.text();

  if (response.status === 202 && rawText.includes("SingleFetchRedirect")) {
    const redirectInfo = JSON.parse(rawText);
    const fullRedirectUrl = redirectInfo[3];
    const match = fullRedirectUrl.match(/\/events\/([^/]+)\/leaderboard/);
    return match[1];
  }

  // No redirect happened - shortId was already the full slug.
  return shortId;
}

async function fetchEventResults(shortId) {
  const fullSlug = await resolveFullSlug(shortId);
  const url = `https://udisc.com/events/${fullSlug}/leaderboard.data?round=1`;
  const response = await fetch(url);
  const value = await decodeResponse(response);
  const data = value["routes/events/$slug/leaderboard"].data;

  return data.roundEntryResults.map(r => ({
    name: r.name,
    division: r.division,
    rank: r.ranking,
    isTie: r.rankingIsTie,
    eventRegistrantId: r.eventRegistrantId,
  }));
}

// --- Run it for every event in the league ---
const events = await fetchEventList("pdgex-2026-9-sezona-91A25y");

for (const event of events) {
  console.log(`\n=== ${event.name} (${event.startDate}) ===`);
  const results = await fetchEventResults(event.shortId);
  console.log(`  ${results.length} players`);
  console.log(`  Winner (div A):`, results.find(r => r.division === "A" && r.rank === 1)?.name);
  console.log(`  Winner (div B):`, results.find(r => r.division === "B" && r.rank === 1)?.name);
}