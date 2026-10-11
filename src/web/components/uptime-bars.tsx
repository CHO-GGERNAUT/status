import type { HourlyAvailabilityResponse } from "../../contracts/status-api";

export function UptimeBars({
  hours,
  componentName,
}: {
  hours: HourlyAvailabilityResponse[];
  componentName: string;
}) {
  const hasInitializedHistory = hours.some((hour) => hour.initializedSeconds > 0);
  const label = `${componentName} availability over the last ${hours.length} hours${hasInitializedHistory ? "; includes history initialized as operational before monitoring" : ""}`;

  return (
    <div className="uptime" role="img" aria-label={label}>
      <div className="uptime__bars" aria-hidden="true">
        {hours.map((hour) => (
          <span
            key={hour.startAt}
            className={`uptime__bar uptime__bar--${barStatus(hour)}`}
            title={`${new Date(hour.startAt).toLocaleString()}: ${hourLabel(hour)}`}
          />
        ))}
      </div>
      <div className="uptime__legend" aria-hidden="true">
        <span>7 days ago</span>
        <span>{hasInitializedHistory ? "Includes initialized history" : "Gray: no data"}</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function barStatus(hour: HourlyAvailabilityResponse): "empty" | "up" | "partial" | "down" {
  if (hour.monitoredSeconds === 0) return hour.initializedSeconds > 0 ? "up" : "empty";
  if (hour.outageSeconds === 0) return "up";
  if (hour.percentage > 0 || hour.initializedSeconds > 0) return "partial";
  return "down";
}

function hourLabel(hour: HourlyAvailabilityResponse): string {
  const observed = hour.monitoredSeconds === 0 ? "No data" : `${hour.percentage}% observed uptime`;
  if (!(hour.initializedSeconds > 0)) return observed;
  const initialized = "Initialized as operational before monitoring";
  return hour.monitoredSeconds === 0 ? initialized : `${observed}; ${initialized}`;
}
