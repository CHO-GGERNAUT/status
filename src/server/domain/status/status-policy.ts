import type { ComponentStatus, PublicComponentStatus } from "../../../contracts/status-api";
import type {
  ComponentState,
  IncidentMutation,
  StatusComponent,
  StoredComponentStatus,
} from "./types";

const STATUS_SEVERITY: Record<PublicComponentStatus, number> = {
  operational: 0,
  unknown: 1,
  degraded: 2,
  outage: 3,
};

export function deriveComponentStatus(
  component: StatusComponent,
  state: ComponentState | null,
  now: number,
): PublicComponentStatus {
  if (state === null) {
    return "unknown";
  }

  if (state.reportedStatus === "outage") {
    return "outage";
  }

  if (now >= state.receivedAt + component.staleAfterSeconds) {
    return "outage";
  }

  return state.reportedStatus;
}

export function deriveOutageStart(
  component: StatusComponent,
  state: ComponentState | null,
): number {
  if (state === null) {
    return component.monitoringStartedAt;
  }

  if (state.reportedStatus === "outage") {
    return state.receivedAt;
  }

  return state.receivedAt + component.staleAfterSeconds;
}

export function worstStatus(statuses: Iterable<PublicComponentStatus>): PublicComponentStatus {
  let result: PublicComponentStatus = "operational";

  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[result]) {
      result = status;
    }
  }

  return result;
}

export function planIncidentMutation(
  stored: StoredComponentStatus,
  nextStatus: ComponentStatus,
  nextMessage: string | null,
  now: number,
): IncidentMutation {
  const { component, state, openIncidentId } = stored;

  if (state === null) {
    return nextStatus === "outage"
      ? { kind: "open", startedAt: now, cause: "reported", summary: nextMessage }
      : { kind: "none" };
  }

  if (openIncidentId !== null) {
    return nextStatus === "outage"
      ? { kind: "none" }
      : { kind: "close", incidentId: openIncidentId, endedAt: now };
  }

  const previousStatus = deriveComponentStatus(component, state, now);

  if (previousStatus !== "outage") {
    return nextStatus === "outage"
      ? {
          kind: "open",
          startedAt: now,
          cause: "reported",
          summary: nextMessage,
        }
      : { kind: "none" };
  }

  const startedAt = deriveOutageStart(component, state);
  const cause = state?.reportedStatus === "outage" ? "reported" : "stale";

  if (nextStatus === "outage") {
    return {
      kind: "open",
      startedAt,
      cause,
      summary: nextMessage,
    };
  }

  return {
    kind: "record",
    startedAt,
    endedAt: now,
    cause,
    summary: state?.message ?? null,
  };
}
