import { describe, expect, it } from "vitest";
import { calculateAvailability } from "../../src/server/domain/status/availability";
import type { StatusIncident } from "../../src/server/domain/status/types";

describe("calculateAvailability", () => {
  it("merges overlapping persisted and virtual outage intervals", () => {
    const incidents: StatusIncident[] = [
      {
        id: 1,
        componentId: 1,
        startedAt: 100,
        endedAt: 200,
        cause: "reported",
        summary: null,
      },
      {
        id: 2,
        componentId: 1,
        startedAt: 180,
        endedAt: 300,
        cause: "stale",
        summary: null,
      },
    ];

    expect(calculateAvailability(0, incidents, 0, 1_000, 250)).toEqual({
      percentage: 10,
      monitoredSeconds: 1_000,
      outageSeconds: 900,
    });
  });

  it("excludes time before monitoring began", () => {
    expect(calculateAvailability(500, [], 0, 1_000)).toEqual({
      percentage: 100,
      monitoredSeconds: 500,
      outageSeconds: 0,
    });
  });
});
