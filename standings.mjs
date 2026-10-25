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

function normalizeName(name) {
  return name.trim().replace(/\s+/g, " ");
}

async function fetchEventResults(shortId) {
  const fullSlug = await resolveFullSlug(shortId);
  const url = `https://udisc.com/events/${fullSlug}/leaderboard.data?round=1`;
  const response = await fetch(url);
  const value = await decodeResponse(response);
  const data = value["routes/events/$slug/leaderboard"].data;

  const registrantLookup = data.registrantDetailLookupByRegistrantId;

  return data.roundEntryResults.map(r => {
    const detail = registrantLookup[r.eventRegistrantId];
    const cleanName = normalizeName(r.name);
    let playerKey = detail?.registrantUserId;
    if (!playerKey) {
      console.warn(`  WARNING: no registrantUserId for "${cleanName}" - falling back to name-based key`);
      playerKey = `name-fallback::${r.division}::${cleanName}`;
    }
    return {
      playerKey,
      displayName: cleanName,
      division: r.division,
      rank: r.ranking,
      isTie: r.rankingIsTie,
    };
  });
}

// --- Scoring engine ---

const SCORING_CONFIG = { start: 100, floor: 1, k: 0.1066 };

function decayPoints(rank, config = SCORING_CONFIG) {
  const { start, floor, k } = config;
  return floor + (start - floor) * Math.exp(-k * (rank - 1));
}

function scoreDivision(players, config = SCORING_CONFIG) {
  const groupsByRank = new Map();
  for (const p of players) {
    if (!groupsByRank.has(p.rank)) groupsByRank.set(p.rank, []);
    groupsByRank.get(p.rank).push(p);
  }

  const scored = [];
  for (const [rank, group] of groupsByRank.entries()) {
    const occupiedPositions = group.map((_, i) => rank + i);
    const pointsValues = occupiedPositions.map(pos => decayPoints(pos, config));
    const avgPoints = pointsValues.reduce((a, b) => a + b, 0) / pointsValues.length;
    for (const p of group) scored.push({ ...p, points: avgPoints });
  }
  return scored;
}

function scoreEvent(allPlayers, config = SCORING_CONFIG) {
  const divisions = [...new Set(allPlayers.map(p => p.division))];
  let result = [];
  for (const div of divisions) {
    result = result.concat(scoreDivision(allPlayers.filter(p => p.division === div), config));
  }
  return result;
}

// --- Season aggregation: progressive "drop the single worst, treating absence as 0" ---

function computeStandings(perEventResults) {
  const M = perEventResults.length;

  const byPlayer = new Map();

  perEventResults.forEach((event, eventIndex) => {
    for (const p of event.players) {
      if (!byPlayer.has(p.playerKey)) {
        byPlayer.set(p.playerKey, {
          displayName: p.displayName,
          division: p.division,
          scores: new Array(M).fill(0),
          played: new Array(M).fill(false),
        });
      }
      const entry = byPlayer.get(p.playerKey);
      entry.scores[eventIndex] = p.points;
      entry.played[eventIndex] = true;
      entry.displayName = p.displayName;
    }
  });

  const standings = [];
  for (const player of byPlayer.values()) {
    const playedCount = player.played.filter(Boolean).length;

    let total;
    let droppedEventName = null;
    let droppedReason = null;

    if (playedCount >= 2) {
      let minIdx = 0;
      for (let i = 1; i < M; i++) {
        if (player.scores[i] < player.scores[minIdx]) minIdx = i;
      }
      total = player.scores.reduce((a, b) => a + b, 0) - player.scores[minIdx];
      droppedEventName = perEventResults[minIdx].eventName;
      droppedReason = player.played[minIdx] ? "lowest score" : "missed event";
    } else {
      total = player.scores.reduce((a, b) => a + b, 0);
      droppedEventName = `Played only ${playedCount} round${playedCount === 1 ? "" : "s"}`;
      droppedReason = `Played only ${playedCount} round${playedCount === 1 ? "" : "s"}`;
    }

    standings.push({
      name: player.displayName,
      division: player.division,
      total: Math.round(total),
      eventsPlayed: playedCount,
      eventsCounted: playedCount >= 2 ? playedCount - 1 : playedCount,
      droppedEvent: droppedEventName,
      droppedReason,
    });
  }

  standings.sort((a, b) => b.total - a.total);

  // Assign explicit rank, 1-based, per division (ranks are computed after sorting)
  const divisions = [...new Set(standings.map(s => s.division))];
  for (const div of divisions) {
    const divPlayers = standings.filter(s => s.division === div);
    divPlayers.forEach((p, i) => { p.rank = i + 1; });
  }

  return standings;
}

// --- Run the full pipeline ---

const events = await fetchEventList("pdgex-2026-9-sezona-91A25y");
console.log(`Found ${events.length} past events. Fetching each...`);

const perEventResults = [];
for (const event of events) {
  const players = await fetchEventResults(event.shortId);
  const scored = scoreEvent(players);
  perEventResults.push({ eventName: event.name, players: scored });
  console.log(`  Fetched and scored: ${event.name}`);
}

const standings = computeStandings(perEventResults);

function printDivision(division) {
  const rows = standings
    .filter(s => s.division === division)
    .map(({ rank, name, total, eventsPlayed, eventsCounted, droppedEvent, droppedReason }) => ({
      rank, name, total, eventsPlayed, eventsCounted, droppedEvent, droppedReason,
    }));
  console.table(rows);
}

console.log("\n--- Division A standings ---");
printDivision("A");

console.log("\n--- Division B standings ---");
printDivision("B");