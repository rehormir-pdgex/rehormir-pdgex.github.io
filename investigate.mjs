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
  return shortId;
}

async function investigateRegistrantDetails(shortId) {
  const fullSlug = await resolveFullSlug(shortId);
  const url = `https://udisc.com/events/${fullSlug}/leaderboard.data?round=1`;
  const response = await fetch(url);
  const value = await decodeResponse(response);
  const data = value["routes/events/$slug/leaderboard"].data;

  console.log("Total registrant detail entries:", Object.keys(data.registrantDetailLookupByRegistrantId).length);
  console.log("\nSample entries:");
  const lookup = data.registrantDetailLookupByRegistrantId;
  const sampleIds = Object.keys(lookup).slice(0, 5);
  for (const id of sampleIds) {
    console.log(id, "->", JSON.stringify(lookup[id]));
  }
}

// --- Run it ---
const events = await fetchEventList("pdgex-2026-9-sezona-91A25y");
await investigateRegistrantDetails(events[0].shortId);