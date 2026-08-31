import { describe, expect, it } from "vitest";
import {
  deriveComponentStatus,
  planIncidentMutation,
  worstStatus,
} from "../../src/server/domain/status/status-policy";
import type {
  ComponentState,
  StatusComponent,
  StoredComponentStatus,
} from "../../src/server/domain/status/types";

const component: StatusComponent = {
  id: 1,
  slug: "ubuntu-main-server",
  group: "devices",
  name: "Main Server",
  description: null,
  staleAfterSeconds: 180,
  sortOrder: 10,
  monitoringStartedAt: 100,
};

const operationalState: ComponentState = {
  componentId: 1,
  reportedStatus: "operational",
  message: null,
  observedAt: null,
  receivedAt: 1_000,
  reporterId: "main-host",
  sequence: 1_000,
};

describe("status policy", () => {
  it("marks a component as outage when the heartbeat reaches the stale threshold", () => {
    expect(deriveComponentStatus(component, operationalState, 1_179)).toBe("operational");
    expect(deriveComponentStatus(component, operationalState, 1_180)).toBe("outage");
  });

  it("records the inferred stale interval when a component recovers", () => {
    const stored: StoredComponentStatus = {
      component,
      state: operationalState,
      openIncidentId: null,
    };

    expect(planIncidentMutation(stored, "operational", "recovered", 1_300)).toEqual({
      kind: "record",
      startedAt: 1_180,
      endedAt: 1_300,
      cause: "stale",
      summary: null,
    });
  });

  it("uses the worst status without dependency propagation", () => {
    expect(worstStatus(["operational", "degraded", "outage"])).toBe("outage");
    expect(worstStatus(["operational", "degraded"])).toBe("degraded");
  });
});
