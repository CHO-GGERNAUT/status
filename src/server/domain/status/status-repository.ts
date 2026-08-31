import type {
  PersistHeartbeat,
  PublicStatusData,
  StoredComponentStatus,
} from "./types";

export interface StatusRepository {
  findComponentStatuses(slugs: readonly string[]): Promise<StoredComponentStatus[]>;
  persistHeartbeat(heartbeat: PersistHeartbeat): Promise<void>;
  getPublicStatusData(incidentSince: number): Promise<PublicStatusData>;
}
