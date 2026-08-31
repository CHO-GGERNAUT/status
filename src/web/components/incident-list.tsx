import type { PublicIncidentResponse } from "../../contracts/status-api";

export function IncidentList({ incidents }: { incidents: PublicIncidentResponse[] }) {
  return (
    <section className="incidents" id="incidents" aria-labelledby="incidents-title">
      <div className="section-heading">
        <div>
          <p className="section-heading__label">History</p>
          <h2 id="incidents-title">Recent incidents</h2>
        </div>
      </div>

      {incidents.length === 0 ? (
        <div className="empty-incidents">
          <span className="empty-incidents__check" aria-hidden="true">
            ✓
          </span>
          <div>
            <strong>No incidents recorded</strong>
            <p>All monitored systems have remained available.</p>
          </div>
        </div>
      ) : (
        <div className="incident-list">
          {incidents.map((incident) => (
            <article className="incident" key={incident.id}>
              <span
                className={`status-dot status-dot--${incident.endedAt === null ? "outage" : "operational"}`}
                aria-hidden="true"
              />
              <div className="incident__body">
                <div className="incident__heading">
                  <h3>{incident.componentName}</h3>
                  <span>{incident.endedAt === null ? "Investigating" : "Resolved"}</span>
                </div>
                <p>{incident.summary ?? defaultSummary(incident)}</p>
                <p className="incident__time">
                  <time dateTime={incident.startedAt}>{formatDate(incident.startedAt)}</time>
                  {incident.endedAt === null ? null : (
                    <>
                      {" — "}
                      <time dateTime={incident.endedAt}>{formatDate(incident.endedAt)}</time>
                    </>
                  )}
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function defaultSummary(incident: PublicIncidentResponse): string {
  return incident.cause === "stale"
    ? "Heartbeat was not received within the expected window."
    : "The reporter marked this component unavailable.";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
