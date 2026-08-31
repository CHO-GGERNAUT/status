import type { AvailabilityWindowResponse } from "../../../contracts/status-api";
import type { StatusIncident } from "./types";

interface Interval {
  start: number;
  end: number;
}

export function calculateAvailability(
  monitoringStartedAt: number,
  incidents: readonly StatusIncident[],
  windowStart: number,
  windowEnd: number,
  virtualOutageStart: number | null = null,
): AvailabilityWindowResponse {
  const monitoredStart = Math.max(monitoringStartedAt, windowStart);
  const monitoredSeconds = Math.max(0, windowEnd - monitoredStart);

  if (monitoredSeconds === 0) {
    return { percentage: 100, monitoredSeconds: 0, outageSeconds: 0 };
  }

  const intervals: Interval[] = [];

  for (const incident of incidents) {
    const start = Math.max(monitoredStart, incident.startedAt);
    const end = Math.min(windowEnd, incident.endedAt ?? windowEnd);

    if (end > start) {
      intervals.push({ start, end });
    }
  }

  if (virtualOutageStart !== null) {
    const start = Math.max(monitoredStart, virtualOutageStart);
    if (windowEnd > start) {
      intervals.push({ start, end: windowEnd });
    }
  }

  intervals.sort((left, right) => left.start - right.start);

  let outageSeconds = 0;
  let active: Interval | null = null;

  for (const interval of intervals) {
    if (active === null) {
      active = { ...interval };
      continue;
    }

    if (interval.start <= active.end) {
      active.end = Math.max(active.end, interval.end);
      continue;
    }

    outageSeconds += active.end - active.start;
    active = { ...interval };
  }

  if (active !== null) {
    outageSeconds += active.end - active.start;
  }

  outageSeconds = Math.min(monitoredSeconds, outageSeconds);
  const percentage = ((monitoredSeconds - outageSeconds) / monitoredSeconds) * 100;

  return {
    percentage: Math.round(percentage * 1000) / 1000,
    monitoredSeconds,
    outageSeconds,
  };
}
