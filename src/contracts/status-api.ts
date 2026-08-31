export type ComponentStatus = "operational" | "degraded" | "outage";

export type ComponentGroupKey = "devices" | "k3s";

export interface HeartbeatObservationRequest {
  component: string;
  status: ComponentStatus;
  message?: string;
}

export interface HeartbeatRequest {
  sequence: number;
  observations: HeartbeatObservationRequest[];
}

export interface HeartbeatResponse {
  acceptedAt: string;
  acceptedComponents: number;
}

export interface AvailabilityWindowResponse {
  percentage: number;
  monitoredSeconds: number;
  outageSeconds: number;
}

export interface DailyAvailabilityResponse extends AvailabilityWindowResponse {
  date: string;
}

export interface PublicComponentResponse {
  slug: string;
  name: string;
  description: string | null;
  status: ComponentStatus;
  message: string | null;
  lastReceivedAt: string | null;
  availability: {
    day: AvailabilityWindowResponse;
    month: AvailabilityWindowResponse;
    quarter: AvailabilityWindowResponse;
  };
  daily: DailyAvailabilityResponse[];
}

export interface PublicGroupResponse {
  key: ComponentGroupKey;
  name: string;
  status: ComponentStatus;
  components: PublicComponentResponse[];
}

export interface PublicIncidentResponse {
  id: string;
  component: string;
  componentName: string;
  startedAt: string;
  endedAt: string | null;
  cause: "reported" | "stale";
  summary: string | null;
}

export interface PublicStatusResponse {
  status: ComponentStatus;
  generatedAt: string;
  groups: PublicGroupResponse[];
  incidents: PublicIncidentResponse[];
}

export interface ApiErrorResponse {
  error: string;
  message: string;
}
