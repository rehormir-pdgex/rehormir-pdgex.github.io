import { decode } from "turbo-stream";

const raw = `[{"_1":2},"routes/api/events/$eventListingId.leaderboard",{"_3":4},"data",{"_5":6},"results",[]]`;

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
console.log("Top-level keys:", Object.keys(result));
console.log("Full result object:", result);
console.log("value specifically:", result.value);