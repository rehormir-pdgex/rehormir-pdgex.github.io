import { decode } from "turbo-stream";
import { readFileSync } from "fs";

const raw = readFileSync("sample-leaderboard-payload.txt", "utf-8");

function stringToStream(str) {
  const bytes = new TextEncoder().encode(str);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

const result = await decode(stringToStream(raw));
const data = result.value["routes/events/$slug/leaderboard"].data;

const simplified = data.roundEntryResults.map(r => ({
  name: r.name,
  division: r.division,
  rank: r.ranking,
  isTie: r.rankingIsTie,
  eventRegistrantId: r.eventRegistrantId,
}));

console.table(simplified);