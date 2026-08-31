import type { PublicComponentResponse } from "../../contracts/status-api";
import { UptimeBars } from "./uptime-bars";

export function ComponentStatusRow({ component }: { component: PublicComponentResponse }) {
  return (
    <article className="component-row">
      <div className="component-row__summary">
        <div>
          <div className="component-row__title-line">
            <span className={`status-dot status-dot--${component.status}`} aria-hidden="true" />
            <h3>{component.name}</h3>
          </div>
          {component.description === null ? null : (
            <p className="component-row__description">{component.description}</p>
          )}
        </div>
        <div className="component-row__metric">
          <strong>{formatPercentage(component.availability.month.percentage)}</strong>
          <span>30 day uptime</span>
        </div>
      </div>

      <UptimeBars days={component.daily} componentName={component.name} />

      <div className="component-row__footer">
        <span className={`status-text status-text--${component.status}`}>
          {statusLabel(component.status)}
        </span>
        <span>
          {component.lastReceivedAt === null
            ? "Waiting for first heartbeat"
            : `Last heartbeat ${formatRelative(component.lastReceivedAt)}`}
        </span>
      </div>
      {component.message === null ? null : (
        <p className="component-row__message">{component.message}</p>
      )}
    </article>
  );
}

function formatPercentage(value: number): string {
  if (value === 100) return "100%";
  return `${value.toFixed(value >= 99 ? 3 : 2)}%`;
}

function formatRelative(value: string): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (elapsedSeconds < 60) return "just now";
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m ago`;
  if (elapsedSeconds < 86_400) return `${Math.floor(elapsedSeconds / 3600)}h ago`;
  return `${Math.floor(elapsedSeconds / 86_400)}d ago`;
}

function statusLabel(status: PublicComponentResponse["status"]): string {
  if (status === "operational") return "Operational";
  if (status === "degraded") return "Degraded";
  return "Outage";
}
