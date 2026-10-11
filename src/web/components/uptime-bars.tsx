import type { HourlyAvailabilityResponse } from "../../contracts/status-api";

export function UptimeBars({
  hours,
  componentName,
}: {
  hours: HourlyAvailabilityResponse[];
  componentName: string;
}) {
  const label = `${componentName} availability over the last ${hours.length} hours`;

  return (
    <div className="uptime" role="img" aria-label={label}>
      <div className="uptime__bars" aria-hidden="true">
        {hours.map((hour) => (
          <span
            key={hour.startAt}
            className={`uptime__bar uptime__bar--${barStatus(hour)}`}
            title={`${new Date(hour.startAt).toLocaleString()}: ${hour.monitoredSeconds === 0 ? "No data" : `${hour.percentage}%`}`}
          />
        ))}
      </div>
      <div className="uptime__legend" aria-hidden="true">
        <span>7 days ago</span>
        <span>Gray: no data</span>
        <span>Now</span>
      </div>
    </div>
  );
}

function barStatus(hour: HourlyAvailabilityResponse): "empty" | "up" | "partial" | "down" {
  if (hour.monitoredSeconds === 0) return "empty";
  if (hour.outageSeconds === 0) return "up";
  if (hour.percentage > 0) return "partial";
  return "down";
}
