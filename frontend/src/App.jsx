import { useState, useEffect } from "react";
import "./App.css";

const DIVISION_COLORS = {
  A: "var(--color-green)",
  B: "var(--color-red)",
};

// Width of each event column, in rem. Raise this if a header shows "..."
const EVENT_COL_REM = 13.5;
// Rank (3.5) + Name (11) + Total (4.5) - must match the widths in App.css
const FIXED_COLS_REM = 19;

// Turns "__ PDGEX 2026 __ 9. sezóna  - 8# NAME (3x5 jamek)" into "8# NAME (3x5 jamek)".
// Starts at the event number so hyphens inside the event's own name can't cut it off,
// and trims trailing spaces/underscores that are part of some event names.
function shortEventLabel(name) {
  const match = name.match(/\d+#.*$/);
  let label;
  if (match) {
    label = match[0];
  } else {
    const idx = name.indexOf(" - ");
    label = idx >= 0 ? name.slice(idx + 3) : name;
  }
  return label.replace(/[\s_]+$/, "").trim();
}

function TableColGroup({ eventCount }) {
  return (
    <colgroup>
      <col className="col-rank" />
      <col className="col-name" />
      <col className="col-total" />
      {Array.from({ length: eventCount }).map((_, i) => (
        <col key={i} />
      ))}
    </colgroup>
  );
}

function EventDetailPanel({ shortId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    fetch(`/data/events/${shortId}.json`)
      .then(res => {
        if (!res.ok) throw new Error(`Could not load event data (${res.status})`);
        return res.json();
      })
      .then(setDetail)
      .catch(err => setError(err.message));
  }, [shortId]);

  return (
    <div className="event-panel">
      <button className="btn secondary close-btn" onClick={onClose}>Close</button>
      {error && <div className="error-text">Error: {error}</div>}
      {!detail && !error && <div>Loading event...</div>}
      {detail && (
        <>
          <h3>{detail.name} — {detail.startDate}</h3>
          {["A", "B"]
            .filter(division => detail.divisions[division])
            .map(division => {
              const players = detail.divisions[division];
              return (
                <div key={division} className="division-block">
                  <div className="division-heading" style={{ "--division-color": DIVISION_COLORS[division] }}>
                    <h2>Division {division}</h2>
                  </div>
                  <div className="table-card">
                    <table className="standings-table">
                      <colgroup>
                        <col className="col-rank" />
                        <col />
                        <col className="col-total" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="numeric">Rank</th>
                          <th>Name</th>
                          <th className="numeric">Points</th>
                        </tr>
                      </thead>
                      <tbody>
                        {players.map((p, i) => (
                          <tr key={i}>
                            <td className="numeric rank-cell" style={{ "--division-color": DIVISION_COLORS[division] }}>
                              {p.rank}{p.isTie ? "=" : ""}
                            </td>
                            <td>{p.displayName}</td>
                            <td className="numeric">{Math.round(p.points)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
        </>
      )}
    </div>
  );
}

function StandingsTable({ division, players, events, onCellClick }) {
  const tableMinWidth = `${FIXED_COLS_REM + events.length * EVENT_COL_REM}rem`;

  return (
    <div className="division-block">
      <div className="division-heading" style={{ "--division-color": DIVISION_COLORS[division] }}>
        <h2>Division {division}</h2>
      </div>
      <div className="table-card">
        <table className="standings-table" style={{ minWidth: tableMinWidth }}>
          <TableColGroup eventCount={events.length} />
          <thead>
            <tr>
              <th className="numeric sticky sticky-rank">Rank</th>
              <th className="sticky sticky-name">Name</th>
              <th className="numeric">Total</th>
              {events.map(e => (
                <th key={e.shortId} className="event-col" title={e.name}>
                  {shortEventLabel(e.name)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map(player => (
              <tr key={player.name}>
                <td
                  className="numeric rank-cell sticky sticky-rank"
                  style={{ "--division-color": DIVISION_COLORS[division] }}
                >
                  {player.rank}
                </td>
                <td className="sticky sticky-name">{player.name}</td>
                <td className="numeric total-cell">{player.total}</td>
                {player.perEvent.map((pe, i) => (
                  <td
                    key={i}
                    className={`event-cell ${!pe.played ? "not-played" : ""}`}
                    onClick={() => pe.played && onCellClick(pe.eventShortId)}
                    title={pe.played ? `Rank ${pe.rank}${pe.isTie ? " (tie)" : ""} - click for event detail` : "Did not play"}
                  >
                    {pe.played ? (
                      <span className={pe.dropped ? "dropped" : ""}>{pe.points}</span>
                    ) : "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    fetch("/data/standings.json")
      .then(res => {
        if (!res.ok) throw new Error(`Could not load standings (${res.status})`);
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message));
  }, []);

  const handleCellClick = (shortId) => {
    setSelectedEvent(shortId);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const lastUpdatedText = data?.lastUpdated
    ? new Date(data.lastUpdated).toLocaleString()
    : null;

  return (
    <div className="page">
      <img src="/pdgex-logo.png" alt="" className="watermark" />

      <header className="header">
        <h1 className="header-title">PDGEX 2026</h1>
        <p className="header-subtitle">
          Season 9 standings{lastUpdatedText ? ` — last updated ${lastUpdatedText}` : ""}
        </p>
      </header>

      <div className="content">
        {error && <div className="error-text">Error: {error}</div>}
        {!data && !error && <div>Loading standings...</div>}

        {data && (
          <>
            {selectedEvent && (
              <EventDetailPanel shortId={selectedEvent} onClose={() => setSelectedEvent(null)} />
            )}

            {["A", "B"]
              .filter(division => data.divisions[division])
              .map(division => (
                <StandingsTable
                  key={division}
                  division={division}
                  players={data.divisions[division]}
                  events={data.events}
                  onCellClick={handleCellClick}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
