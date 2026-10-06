import type {
  ComponentConfiguration,
  ReporterConfiguration,
  ReporterCreationRequest,
  ReporterUpdateRequest,
} from "../../../contracts/admin-api";
import { StatusApplicationError } from "../../application/status/application-error";
import type { ReporterManagementRepository } from "../../domain/status/reporter-management";

export class D1ReporterManagementRepository implements ReporterManagementRepository {
  constructor(private readonly database: D1Database) {}

  async configureComponents(components: ComponentConfiguration[], now: number) {
    await this.database.batch(components.map((item) => this.database.prepare(`
      INSERT INTO components (slug, group_key, display_name, description, stale_after_seconds, sort_order, enabled, monitoring_started_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET group_key = excluded.group_key, display_name = excluded.display_name,
        description = excluded.description, stale_after_seconds = excluded.stale_after_seconds,
        sort_order = excluded.sort_order, enabled = COALESCE(?, components.enabled)
    `).bind(item.slug, item.group, item.name, item.description ?? null, item.staleAfterSeconds ?? 180,
      item.sortOrder ?? 0, item.enabled === false ? 0 : 1, now,
      item.enabled === undefined ? null : Number(item.enabled))));
  }

  async createReporter(reporter: ReporterCreationRequest, tokenHash: string, now: number) {
    if (await this.getReporter(reporter.id)) throw new StatusApplicationError("conflict", "Reporter already exists; use update or token rotation");
    await this.validateComponents(reporter.components);
    try {
      await this.database.batch([
        this.database.prepare("INSERT INTO reporters (id, display_name, token_hash, created_at) VALUES (?, ?, ?, ?)")
          .bind(reporter.id, reporter.name ?? reporter.id, tokenHash, now),
        ...this.grants(reporter.id, reporter.components),
      ]);
    } catch (error) {
      if (await this.getReporter(reporter.id)) throw new StatusApplicationError("conflict", "Reporter already exists; use update or token rotation");
      throw error;
    }
  }

  async getReporter(id: string): Promise<ReporterConfiguration | null> {
    const result = await this.database.prepare(`
      SELECT r.id, r.display_name, r.enabled, c.slug FROM reporters r
      LEFT JOIN reporter_components rc ON rc.reporter_id = r.id
      LEFT JOIN components c ON c.id = rc.component_id
      WHERE r.id = ? ORDER BY c.slug
    `).bind(id).all<{ id: string; display_name: string; enabled: number; slug: string | null }>();
    const first = result.results[0];
    if (!first) return null;
    return { id: first.id, name: first.display_name, enabled: first.enabled === 1,
      components: result.results.flatMap((row) => row.slug === null ? [] : [row.slug]) };
  }

  async updateReporter(id: string, patch: ReporterUpdateRequest) {
    await this.requireReporter(id);
    if (patch.components !== undefined) await this.validateComponents(patch.components);
    const statements = [this.database.prepare("UPDATE reporters SET display_name = COALESCE(?, display_name), enabled = COALESCE(?, enabled) WHERE id = ?")
      .bind(patch.name ?? null, patch.enabled === undefined ? null : Number(patch.enabled), id)];
    if (patch.components !== undefined) statements.push(
      this.database.prepare("DELETE FROM reporter_components WHERE reporter_id = ?").bind(id),
      ...this.grants(id, patch.components),
    );
    await this.database.batch(statements);
  }

  async rotateReporterToken(id: string, tokenHash: string) {
    const result = await this.database.prepare("UPDATE reporters SET token_hash = ?, last_sequence = 0 WHERE id = ?")
      .bind(tokenHash, id).run();
    if (result.meta.changes === 0) throw new StatusApplicationError("not_found", "Reporter does not exist");
  }

  private grants(id: string, slugs: string[]) {
    // A missing/disabled component produces NULL and fails the NOT NULL constraint,
    // rolling back the batch even if configuration changed after validation.
    return slugs.map((slug) => this.database.prepare(`
      INSERT INTO reporter_components (reporter_id, component_id)
      VALUES (?, (SELECT id FROM components WHERE slug = ? AND enabled = 1))
    `).bind(id, slug));
  }

  private async validateComponents(slugs: string[]) {
    const result = await this.database.prepare(`SELECT slug FROM components WHERE enabled = 1 AND slug IN (${slugs.map(() => "?").join(", ")})`)
      .bind(...slugs).all<{ slug: string }>();
    if (result.results.length !== slugs.length) throw new StatusApplicationError("invalid_input", "Every component must be registered and enabled");
  }

  private async requireReporter(id: string) {
    if (!await this.getReporter(id)) throw new StatusApplicationError("not_found", "Reporter does not exist");
  }
}
