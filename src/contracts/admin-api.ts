import type { ComponentGroupKey } from "./status-api";

export interface ComponentConfiguration {
  slug: string;
  group: ComponentGroupKey;
  name: string;
  description?: string | null;
  staleAfterSeconds?: number;
  sortOrder?: number;
  enabled?: boolean;
}

export interface ReporterConfiguration {
  id: string;
  name: string;
  enabled: boolean;
  components: string[];
}

export interface ReporterCreationRequest {
  id: string;
  name?: string;
  components: string[];
}

export interface ReporterUpdateRequest {
  name?: string;
  enabled?: boolean;
  components?: string[];
}

export interface ReporterTokenResponse {
  reporterId: string;
  token: string;
}
