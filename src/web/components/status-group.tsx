import type { PublicGroupResponse } from "../../contracts/status-api";
import { ComponentStatusRow } from "./status-row";

export function StatusGroup({ group }: { group: PublicGroupResponse }) {
  return (
    <section className="status-section" id={group.key} aria-labelledby={`${group.key}-title`}>
      <div className="section-heading">
        <div>
          <p className="section-heading__label">Live systems</p>
          <h2 id={`${group.key}-title`}>{group.name}</h2>
        </div>
        <span className={`status-pill status-pill--${group.status}`}>
          <span className={`status-dot status-dot--${group.status}`} aria-hidden="true" />
          {statusLabel(group.status)}
        </span>
      </div>

      <div className="component-list">
        {group.components.map((component) => (
          <ComponentStatusRow key={component.slug} component={component} />
        ))}
      </div>
    </section>
  );
}

function statusLabel(status: PublicGroupResponse["status"]): string {
  if (status === "unknown") return "Awaiting heartbeat";
  if (status === "operational") return "Operational";
  if (status === "degraded") return "Degraded";
  return "Outage";
}
