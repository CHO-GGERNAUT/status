import type { ComponentGroupKey, ComponentStatus } from "../../../contracts/status-api";

export interface StatusComponent {
  id: number;
  slug: string;
  group: ComponentGroupKey;
  name: string;
  description: string | null;
  staleAfterSeconds: number;
  sortOrder: number;
  monitoringStartedAt: number;
}

export interface ComponentState {
  componentId: number;
  reportedStatus: ComponentStatus;
  message: string | null;
  observedAt: number | null;
  receivedAt: number;
  reporterId: string;
  sequence: number;
}

export interface StatusIncident {
  id: number;
  componentId: number;
  startedAt: number;
  endedAt: number | null;
  cause: "reported" | "stale";
  summary: string | null;
}

export interface StoredComponentStatus {
  component: StatusComponent;
  state: ComponentState | null;
  openIncidentId: number | null;
}

export interface ReporterIdentity {
  id: string;
  lastSequence: number;
  allowedComponentSlugs: ReadonlySet<string>;
}

export type IncidentMutation =
  | { kind: "none" }
  | { kind: "open"; startedAt: number; cause: "reported" | "stale"; summary: string | null }
  | { kind: "close"; incidentId: number; endedAt: number }
  | {
      kind: "record";
      startedAt: number;
      endedAt: number;
      cause: "reported" | "stale";
      summary: string | null;
    };

export interface HeartbeatStateMutation {
  component: StatusComponent;
  status: ComponentStatus;
  message: string | null;
  observedAt: number | null;
  receivedAt: number;
  incident: IncidentMutation;
}

export interface PersistHeartbeat {
  reporterId: string;
  sequence: number;
  mutations: HeartbeatStateMutation[];
}

export interface PublicStatusData {
  components: StoredComponentStatus[];
  incidents: StatusIncident[];
}
