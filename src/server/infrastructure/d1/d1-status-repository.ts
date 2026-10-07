import type { ComponentGroupKey, ComponentStatus } from "../../../contracts/status-api";
import { StatusApplicationError } from "../../application/status/application-error";
import type { StatusRepository } from "../../domain/status/status-repository";
import type {
  ComponentState,
  PersistHeartbeat,
  PublicStatusData,
  StatusComponent,
  StatusIncident,
  StoredComponentStatus,
} from "../../domain/status/types";

interface ComponentStateRow {
  component_id: number;
  slug: string;
  group_key: ComponentGroupKey;
  display_name: string;
  description: string | null;
  stale_after_seconds: number;
  sort_order: number;
  monitoring_started_at: number;
  reported_status: ComponentStatus | null;
  message: string | null;
  observed_at: number | null;
  received_at: number | null;
  reporter_id: string | null;
  sequence: number | null;
  open_incident_id: number | null;
}

interface IncidentRow {
  id: number;
  component_id: number;
  started_at: number;
  ended_at: number | null;
  cause: "reported" | "stale";
  summary: string | null;
}

const COMPONENT_STATUS_SELECT = `
  SELECT
    c.id AS component_id,
    c.slug,
    c.group_key,
    c.display_name,
    c.description,
    c.stale_after_seconds,
    c.sort_order,
    c.monitoring_started_at,
    s.reported_status,
    s.message,
    s.observed_at,
    s.received_at,
    s.reporter_id,
    s.sequence,
    i.id AS open_incident_id
  FROM components c
  LEFT JOIN current_states s ON s.component_id = c.id
  LEFT JOIN incidents i ON i.component_id = c.id AND i.ended_at IS NULL
`;

export class D1StatusRepository implements StatusRepository {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async findComponentStatuses(slugs: readonly string[]): Promise<StoredComponentStatus[]> {
    if (slugs.length === 0) {
      return [];
    }

    const placeholders = slugs.map(() => "?").join(", ");
    const result = await this.#database
      .prepare(`${COMPONENT_STATUS_SELECT} WHERE c.enabled = 1 AND c.group_key = 'devices' AND c.slug IN (${placeholders})`)
      .bind(...slugs)
      .all<ComponentStateRow>();

    return result.results.map(toStoredComponentStatus);
  }

  async persistHeartbeat(heartbeat: PersistHeartbeat): Promise<void> {
    const receivedAt = heartbeat.mutations[0]?.receivedAt;
    if (receivedAt === undefined) {
      return;
    }

    const slugs = heartbeat.mutations.map((mutation) => mutation.component.slug);
    const placeholders = slugs.map(() => "?").join(", ");
    const statements: D1PreparedStatement[] = [
      this.#database
        .prepare(
          `UPDATE reporters
           SET last_sequence = CASE WHEN enabled = 1 AND token_hash = ? AND last_sequence < ?
             AND ? = (SELECT COUNT(*) FROM reporter_components rc
               JOIN components c ON c.id = rc.component_id
               WHERE rc.reporter_id = reporters.id AND c.enabled = 1 AND c.group_key = 'devices' AND c.slug IN (${placeholders}))
             THEN ? ELSE NULL END,
             last_seen_at = ?
           WHERE id = ?`,
        )
        .bind(heartbeat.tokenHash, heartbeat.sequence, slugs.length, ...slugs,
          heartbeat.sequence, receivedAt, heartbeat.reporterId),
    ];

    for (const mutation of heartbeat.mutations) {
      statements.push(
        this.#database.prepare(`UPDATE components SET monitoring_started_at = ?
          WHERE id = ? AND NOT EXISTS (
            SELECT 1 FROM current_states WHERE component_id = components.id
          )`).bind(mutation.receivedAt, mutation.component.id),
      );
      const incident = mutation.incident;
      if (incident.kind === "open") {
        statements.push(
          this.#database
            .prepare(
              `INSERT OR IGNORE INTO incidents
                 (component_id, started_at, ended_at, cause, summary)
               VALUES (?, ?, NULL, ?, ?)`,
            )
            .bind(
              mutation.component.id,
              incident.startedAt,
              incident.cause,
              incident.summary,
            ),
        );
      } else if (incident.kind === "close") {
        statements.push(
          this.#database
            .prepare("UPDATE incidents SET ended_at = ? WHERE id = ? AND ended_at IS NULL")
            .bind(incident.endedAt, incident.incidentId),
        );
      } else if (incident.kind === "record") {
        statements.push(
          this.#database
            .prepare(
              `INSERT INTO incidents
                 (component_id, started_at, ended_at, cause, summary)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .bind(
              mutation.component.id,
              incident.startedAt,
              incident.endedAt,
              incident.cause,
              incident.summary,
            ),
        );
      }

      statements.push(
        this.#database
          .prepare(
            `INSERT INTO current_states
               (component_id, reported_status, message, observed_at, received_at, reporter_id, sequence)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(component_id) DO UPDATE SET
               reported_status = excluded.reported_status,
               message = excluded.message,
               observed_at = excluded.observed_at,
               received_at = excluded.received_at,
               reporter_id = excluded.reporter_id,
               sequence = excluded.sequence`,
          )
          .bind(
            mutation.component.id,
            mutation.status,
            mutation.message,
            mutation.observedAt,
            mutation.receivedAt,
            heartbeat.reporterId,
            heartbeat.sequence,
          ),
      );
    }

    // last_sequence is NOT NULL: stale authentication, permissions or sequence
    // abort the entire D1 transaction before state/history can change.
    try {
      const result = await this.#database.batch(statements);
      if (result[0].meta.changes === 0) throw new StatusApplicationError("unauthorized", "Reporter no longer exists");
    } catch (error) {
      const reporter = await this.#database.prepare("SELECT enabled, token_hash, last_sequence FROM reporters WHERE id = ?")
        .bind(heartbeat.reporterId).all<{ enabled: number; token_hash: string; last_sequence: number }>();
      const current = reporter.results[0];
      if (!current || current.enabled !== 1 || current.token_hash !== heartbeat.tokenHash) {
        throw new StatusApplicationError("unauthorized", "Reporter credentials were revoked");
      }
      if (current.last_sequence >= heartbeat.sequence) throw new StatusApplicationError("conflict", "Heartbeat sequence has already been used");
      const grants = await this.#database.prepare(`SELECT c.slug FROM reporter_components rc
        JOIN components c ON c.id = rc.component_id
        WHERE rc.reporter_id = ? AND c.enabled = 1 AND c.group_key = 'devices' AND c.slug IN (${placeholders})`)
        .bind(heartbeat.reporterId, ...slugs).all<{ slug: string }>();
      if (grants.results.length !== slugs.length) throw new StatusApplicationError("unauthorized", "Reporter permissions were revoked");
      throw error;
    }
  }

  async getPublicStatusData(incidentSince: number): Promise<PublicStatusData> {
    const [componentResult, incidentResult] = await Promise.all([
      this.#database
        .prepare(
          `${COMPONENT_STATUS_SELECT}
           WHERE c.enabled = 1 AND c.group_key = 'devices'
           ORDER BY c.sort_order, c.id`,
        )
        .all<ComponentStateRow>(),
      this.#database
        .prepare(
          `SELECT id, component_id, started_at, ended_at, cause, summary
           FROM incidents
           WHERE ended_at IS NULL OR ended_at >= ?
           ORDER BY started_at DESC`,
        )
        .bind(incidentSince)
        .all<IncidentRow>(),
    ]);

    return {
      components: componentResult.results.map(toStoredComponentStatus),
      incidents: incidentResult.results.map(toIncident),
    };
  }
}

function toStoredComponentStatus(row: ComponentStateRow): StoredComponentStatus {
  const component: StatusComponent = {
    id: row.component_id,
    slug: row.slug,
    group: row.group_key,
    name: row.display_name,
    description: row.description,
    staleAfterSeconds: row.stale_after_seconds,
    sortOrder: row.sort_order,
    monitoringStartedAt: row.monitoring_started_at,
  };

  const state: ComponentState | null =
    row.reported_status === null ||
    row.received_at === null ||
    row.reporter_id === null ||
    row.sequence === null
      ? null
      : {
          componentId: row.component_id,
          reportedStatus: row.reported_status,
          message: row.message,
          observedAt: row.observed_at,
          receivedAt: row.received_at,
          reporterId: row.reporter_id,
          sequence: row.sequence,
        };

  return { component, state, openIncidentId: row.open_incident_id };
}

function toIncident(row: IncidentRow): StatusIncident {
  return {
    id: row.id,
    componentId: row.component_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    cause: row.cause,
    summary: row.summary,
  };
}
