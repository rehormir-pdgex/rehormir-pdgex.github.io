import { decode } from "turbo-stream";
import { readFileSync } from "fs";

function stringToStream(str) {
  const bytes = new TextEncoder().encode(str);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

// --- Scoring engine ---

const SCORING_CONFIG = {
  start: 100,   // points for rank 1
  floor: 1,     // asymptotic minimum, never reached, never zero
  k: 0.1066,    // decay rate, fitted to roughly match 100/90/82 at ranks 1/2/3
};

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
    const size = group.length;
    const occupiedPositions = [];
    for (let i = 0; i < size; i++) occupiedPositions.push(rank + i);

    const pointsValues = occupiedPositions.map(pos => decayPoints(pos, config));
    const avgPoints = pointsValues.reduce((a, b) => a + b, 0) / pointsValues.length;

    for (const p of group) {
      scored.push({ ...p, points: avgPoints });
    }
  }

  scored.sort((a, b) => a.rank - b.rank);
  return scored;
}

function scoreEvent(allPlayers, config = SCORING_CONFIG) {
  const divisions = [...new Set(allPlayers.map(p => p.division))];
  let result = [];
  for (const div of divisions) {
    const divPlayers = allPlayers.filter(p => p.division === div);
    result = result.concat(scoreDivision(divPlayers, config));
  }
  return result;
}

// --- Load the real Krimice payload and test against it ---

const raw = readFileSync("sample-leaderboard-payload.txt", "utf-8");
const decoded = await decode(stringToStream(raw));
const data = decoded.value["routes/events/$slug/leaderboard"].data;

const players = data.roundEntryResults.map(r => ({
  name: r.name,
  division: r.division,
  rank: r.ranking,
  isTie: r.rankingIsTie,
}));

const scored = scoreEvent(players);

console.log("--- Division A ---");
console.table(scored.filter(p => p.division === "A").map(p => ({
  name: p.name, rank: p.rank, isTie: p.isTie, points: Math.round(p.points),
})));

console.log("--- Division B ---");
console.table(scored.filter(p => p.division === "B").map(p => ({
  name: p.name, rank: p.rank, isTie: p.isTie, points: Math.round(p.points),
})));