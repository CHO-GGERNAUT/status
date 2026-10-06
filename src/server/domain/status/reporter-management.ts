import type {
  ComponentConfiguration,
  ReporterConfiguration,
  ReporterCreationRequest,
  ReporterUpdateRequest,
} from "../../../contracts/admin-api";

export interface ReporterRegistration extends ReporterCreationRequest {
  components: string[];
  deviceComponent?: ComponentConfiguration;
}

export interface ReporterManagementRepository {
  configureComponents(components: ComponentConfiguration[], now: number): Promise<void>;
  createReporter(reporter: ReporterRegistration, tokenHash: string, now: number): Promise<void>;
  getReporter(id: string): Promise<ReporterConfiguration | null>;
  updateReporter(id: string, patch: ReporterUpdateRequest): Promise<void>;
  rotateReporterToken(id: string, tokenHash: string): Promise<void>;
}

export interface ReporterTokenIssuer {
  issue(reporterId: string): Promise<{ token: string; hash: string }>;
}
