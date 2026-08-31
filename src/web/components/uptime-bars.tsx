import type { DailyAvailabilityResponse } from "../../contracts/status-api";

export function UptimeBars({
  days,
  componentName,
}: {
  days: DailyAvailabilityResponse[];
  componentName: string;
}) {
  const latest = days.at(-1);
  const label = `${componentName} availability over the last ${days.length} days`;

  return (
    <div className="uptime" role="img" aria-label={label}>
      <div className="uptime__bars" aria-hidden="true">
        {days.map((day) => (
          <span
            key={day.date}
            className={`uptime__bar uptime__bar--${barStatus(day)}`}
            title={`${day.date}: ${day.percentage}%`}
          />
        ))}
      </div>
      <div className="uptime__legend" aria-hidden="true">
        <span>90 days ago</span>
        <span>{latest?.date ?? "Today"}</span>
      </div>
    </div>
  );
}

function barStatus(day: DailyAvailabilityResponse): "empty" | "up" | "partial" | "down" {
  if (day.monitoredSeconds === 0) return "empty";
  if (day.outageSeconds === 0) return "up";
  if (day.percentage > 0) return "partial";
  return "down";
}
