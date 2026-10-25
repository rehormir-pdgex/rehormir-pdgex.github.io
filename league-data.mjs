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
          const pastEvents = value["routes/leagues/$slug/events-in-series"].data.leagueEvents.pastEvents;

          // UDisc returns these newest-first; we want chronological (event #1 first).
          return [...pastEvents].reverse();
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

        // Fetches and returns BOTH the raw player list and the event's own name/date,
        // so a single call can serve either the season pipeline or the detail endpoint.
        async function fetchEventData(shortId) {
          const fullSlug = await resolveFullSlug(shortId);
          const url = `https://udisc.com/events/${fullSlug}/leaderboard.data?round=1`;
          const response = await fetch(url);
          const value = await decodeResponse(response);
          const data = value["routes/events/$slug/leaderboard"].data;

          const registrantLookup = data.registrantDetailLookupByRegistrantId;

          const players = data.roundEntryResults.map(r => {
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

          return {
            name: data.eventListing?.name?.trim() ?? shortId,
            startDate: data.eventListing?.startDate ?? null,
            players,
          };
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

        // --- Season aggregation, now also building a per-event breakdown per player ---

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
                  ranks: new Array(M).fill(null),
                  isTie: new Array(M).fill(false),
                });
              }
              const entry = byPlayer.get(p.playerKey);
              entry.scores[eventIndex] = p.points;
              entry.played[eventIndex] = true;
              entry.ranks[eventIndex] = p.rank;
              entry.isTie[eventIndex] = p.isTie;
              entry.displayName = p.displayName;
            }
          });

          const standings = [];
          for (const player of byPlayer.values()) {
            const playedCount = player.played.filter(Boolean).length;

            let total;
            let droppedEventIndex = null;
            let droppedEventName;
            let droppedReason;

            if (playedCount >= 2) {
              let minIdx = 0;
              for (let i = 1; i < M; i++) {
                if (player.scores[i] < player.scores[minIdx]) minIdx = i;
              }
              total = player.scores.reduce((a, b) => a + b, 0) - player.scores[minIdx];
              droppedEventIndex = minIdx;
              droppedEventName = perEventResults[minIdx].eventName;
              droppedReason = player.played[minIdx] ? "lowest score" : "missed event";
            } else {
              total = player.scores.reduce((a, b) => a + b, 0);
              droppedEventName = `Played only ${playedCount} round${playedCount === 1 ? "" : "s"}`;
              droppedReason = `Played only ${playedCount} round${playedCount === 1 ? "" : "s"}`;
            }

            const perEvent = perEventResults.map((event, i) => ({
              eventName: event.eventName,
              eventShortId: event.eventShortId,
              played: player.played[i],
              points: player.played[i] ? Math.round(player.scores[i]) : null,
              rank: player.ranks[i],
              isTie: player.isTie[i],
              dropped: i === droppedEventIndex,
            }));

            standings.push({
              name: player.displayName,
              division: player.division,
              total: Math.round(total),
              eventsPlayed: playedCount,
              eventsCounted: playedCount >= 2 ? playedCount - 1 : playedCount,
              droppedEvent: droppedEventName,
              droppedReason,
              perEvent,
            });
          }

          standings.sort((a, b) => b.total - a.total);

          const divisions = [...new Set(standings.map(s => s.division))];
          for (const div of divisions) {
            standings.filter(s => s.division === div).forEach((p, i) => { p.rank = i + 1; });
          }

          return standings;
        }

        // --- Public functions ---

        export async function getLeagueStandings(leagueSlug) {
          const events = await fetchEventList(leagueSlug);

          const perEventResults = [];
          for (const event of events) {
            const eventData = await fetchEventData(event.shortId);
            const scored = scoreEvent(eventData.players);
            perEventResults.push({
              eventName: eventData.name,
              eventShortId: event.shortId,
              startDate: eventData.startDate,
              players: scored,
            });
          }

          const standings = computeStandings(perEventResults);

          const divisions = {};
          for (const s of standings) {
            if (!divisions[s.division]) divisions[s.division] = [];
            divisions[s.division].push(s);
          }

          return {
            events: perEventResults.map(e => ({
              name: e.eventName,
              shortId: e.eventShortId,
              startDate: e.startDate,
            })),
            divisions,
          };
        }

        export async function getEventDetail(eventShortId) {
          const eventData = await fetchEventData(eventShortId);
          const scored = scoreEvent(eventData.players);

          const divisions = {};
          for (const p of scored) {
            if (!divisions[p.division]) divisions[p.division] = [];
            divisions[p.division].push(p);
          }
          for (const div of Object.keys(divisions)) {
            divisions[div].sort((a, b) => a.rank - b.rank);
          }

          return {
            name: eventData.name,
            startDate: eventData.startDate,
            shortId: eventShortId,
            divisions,
          };
        }