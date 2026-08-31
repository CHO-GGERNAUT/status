import type { ReporterIdentity } from "./types";

export interface ReporterAuthenticator {
  authenticate(bearerToken: string): Promise<ReporterIdentity | null>;
}
