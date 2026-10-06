import type {
  ComponentConfiguration,
  ReporterCreationRequest,
  ReporterTokenResponse,
  ReporterUpdateRequest,
} from "../../../contracts/admin-api";
import type {
  ReporterManagementRepository,
  ReporterTokenIssuer,
} from "../../domain/status/reporter-management";
import { StatusApplicationError } from "./application-error";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_COMPONENTS = 20;

export async function configureComponents(
  input: unknown,
  repository: ReporterManagementRepository,
  now: number,
): Promise<number> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_COMPONENTS) {
    invalid("Provide between 1 and 20 components");
  }
  const components = input.map((item): ComponentConfiguration => {
    const value = object(item, ["slug", "group", "name", "description", "staleAfterSeconds", "sortOrder", "enabled"]);
    identifier(value.slug);
    displayName(value.name);
    if (value.group !== "devices"
      || (value.description !== undefined && value.description !== null
        && (typeof value.description !== "string" || value.description.length > 500))
      || (value.staleAfterSeconds !== undefined
        && (!Number.isSafeInteger(value.staleAfterSeconds) || (value.staleAfterSeconds as number) < 60))
      || (value.sortOrder !== undefined && !Number.isSafeInteger(value.sortOrder))
      || (value.enabled !== undefined && typeof value.enabled !== "boolean")) {
      invalid("Invalid component configuration");
    }
    return value as unknown as ComponentConfiguration;
  });
  if (new Set(components.map((item) => item.slug)).size !== components.length) invalid("Duplicate component slug");
  await repository.configureComponents(components, now);
  return components.length;
}

export async function createReporter(
  input: unknown,
  repository: ReporterManagementRepository,
  tokens: ReporterTokenIssuer,
  now: number,
): Promise<ReporterTokenResponse> {
  const value = object(input, ["id", "name", "components"]);
  identifier(value.id);
  if (value.name !== undefined) displayName(value.name);
  if (value.components !== undefined) componentSlugs(value.components);
  const reporter = value as unknown as ReporterCreationRequest;
  const issued = await tokens.issue(reporter.id);
  await repository.createReporter({
    ...reporter,
    components: reporter.components ?? [reporter.id],
    ...(reporter.components === undefined ? {
      deviceComponent: { slug: reporter.id, group: "devices", name: reporter.name ?? reporter.id },
    } : {}),
  }, issued.hash, now);
  return { reporterId: reporter.id, token: issued.token };
}

export async function updateReporter(
  id: string,
  input: unknown,
  repository: ReporterManagementRepository,
) {
  identifier(id);
  const value = object(input, ["name", "enabled", "components"]);
  if (Object.keys(value).length === 0) invalid("Provide a reporter update");
  if (value.name !== undefined) displayName(value.name);
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") invalid("enabled must be boolean");
  if (value.components !== undefined) componentSlugs(value.components);
  await repository.updateReporter(id, value as ReporterUpdateRequest);
  return repository.getReporter(id);
}

export async function rotateReporterToken(
  id: string,
  repository: ReporterManagementRepository,
  tokens: ReporterTokenIssuer,
): Promise<ReporterTokenResponse> {
  identifier(id);
  const issued = await tokens.issue(id);
  await repository.rotateReporterToken(id, issued.hash);
  return { reporterId: id, token: issued.token };
}

function object(input: unknown, allowed: string[]): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !allowed.includes(key))) invalid("Invalid or unknown configuration fields");
  return input as Record<string, unknown>;
}

function identifier(input: unknown): asserts input is string {
  if (typeof input !== "string" || !SLUG_PATTERN.test(input)) invalid("Identifiers must use lowercase letters, numbers and hyphens");
}

function displayName(input: unknown) {
  if (typeof input !== "string" || input.trim().length === 0 || input.length > 120) invalid("Provide a display name of at most 120 characters");
}

function componentSlugs(input: unknown) {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_COMPONENTS) invalid("Provide between 1 and 20 component slugs");
  for (const slug of input) identifier(slug);
  if (new Set(input).size !== input.length) invalid("Duplicate component slug");
}

function invalid(message: string): never {
  throw new StatusApplicationError("invalid_input", message);
}
