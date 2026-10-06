import type { ReporterAuthenticator } from "../../domain/status/reporter-authenticator";
import type { ReporterIdentity } from "../../domain/status/types";
import { constantTimeEqual, sha256Hex } from "./token-crypto";

interface ReporterRow {
  id: string;
  token_hash: string;
  last_sequence: number;
  component_slug: string;
}

export class D1ReporterAuthenticator implements ReporterAuthenticator {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async authenticate(bearerToken: string): Promise<ReporterIdentity | null> {
    const separator = bearerToken.indexOf(".");
    if (separator <= 0) {
      return null;
    }

    const reporterId = bearerToken.slice(0, separator);
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(reporterId)) {
      return null;
    }

    const result = await this.#database
      .prepare(
        `SELECT
           r.id,
           r.token_hash,
           r.last_sequence,
           c.slug AS component_slug
         FROM reporters r
         JOIN reporter_components rc ON rc.reporter_id = r.id
         JOIN components c ON c.id = rc.component_id
         WHERE r.id = ? AND r.enabled = 1 AND c.enabled = 1`,
      )
      .bind(reporterId)
      .all<ReporterRow>();

    const first = result.results[0];
    if (first === undefined) {
      return null;
    }

    const actualHash = await sha256Hex(bearerToken);
    if (!constantTimeEqual(actualHash, first.token_hash)) {
      return null;
    }

    return {
      id: first.id,
      tokenHash: first.token_hash,
      lastSequence: first.last_sequence,
      allowedComponentSlugs: new Set(result.results.map((row) => row.component_slug)),
    };
  }
}
