import type {
  ComponentStatus,
  HeartbeatObservationRequest,
  HeartbeatResponse,
} from "../../../contracts/status-api";
import type { ReporterAuthenticator } from "../../domain/status/reporter-authenticator";
import type { StatusRepository } from "../../domain/status/status-repository";
import { planIncidentMutation } from "../../domain/status/status-policy";
import type { HeartbeatStateMutation } from "../../domain/status/types";
import { StatusApplicationError } from "./application-error";

const VALID_STATUSES = new Set<ComponentStatus>(["operational", "degraded", "outage"]);
const MAX_OBSERVATIONS = 20;
const MAX_MESSAGE_LENGTH = 160;

export interface RecordHeartbeatCommand {
  bearerToken: string;
  sequence: number;
  observations: HeartbeatObservationRequest[];
  receivedAt: number;
}

export interface RecordHeartbeatDependencies {
  authenticator: ReporterAuthenticator;
  repository: StatusRepository;
}

export async function recordHeartbeat(
  command: RecordHeartbeatCommand,
  dependencies: RecordHeartbeatDependencies,
): Promise<HeartbeatResponse> {
  validateCommand(command);

  const reporter = await dependencies.authenticator.authenticate(command.bearerToken);
  if (reporter === null) {
    throw new StatusApplicationError("unauthorized", "Invalid reporter token");
  }

  if (command.sequence <= reporter.lastSequence) {
    throw new StatusApplicationError("conflict", "Heartbeat sequence has already been used");
  }

  const uniqueSlugs = new Set<string>();
  for (const observation of command.observations) {
    if (uniqueSlugs.has(observation.component)) {
      throw new StatusApplicationError("invalid_input", "Duplicate component in heartbeat");
    }
    if (!reporter.allowedComponentSlugs.has(observation.component)) {
      throw new StatusApplicationError(
        "unauthorized",
        "Reporter is not allowed to update this component",
      );
    }
    uniqueSlugs.add(observation.component);
  }

  const storedStatuses = await dependencies.repository.findComponentStatuses([...uniqueSlugs]);
  const storedBySlug = new Map(storedStatuses.map((stored) => [stored.component.slug, stored]));

  if (storedBySlug.size !== uniqueSlugs.size) {
    throw new StatusApplicationError("invalid_input", "Heartbeat contains an unknown component");
  }

  const mutations: HeartbeatStateMutation[] = [];
  for (const observation of command.observations) {
    const stored = storedBySlug.get(observation.component);
    if (stored === undefined) {
      throw new StatusApplicationError("internal_error", "Component lookup failed");
    }

    const message = normalizeMessage(observation.message);
    mutations.push({
      component: stored.component,
      status: observation.status,
      message,
      observedAt: null,
      receivedAt: command.receivedAt,
      incident: planIncidentMutation(stored, observation.status, message, command.receivedAt),
    });
  }

  await dependencies.repository.persistHeartbeat({
    reporterId: reporter.id,
    tokenHash: reporter.tokenHash,
    sequence: command.sequence,
    mutations,
  });

  return {
    acceptedAt: new Date(command.receivedAt * 1000).toISOString(),
    acceptedComponents: mutations.length,
  };
}

function validateCommand(command: RecordHeartbeatCommand): void {
  if (!Number.isSafeInteger(command.sequence) || command.sequence <= 0) {
    throw new StatusApplicationError("invalid_input", "Sequence must be a positive integer");
  }

  if (
    command.observations.length === 0 ||
    command.observations.length > MAX_OBSERVATIONS
  ) {
    throw new StatusApplicationError(
      "invalid_input",
      `Heartbeat must contain between 1 and ${MAX_OBSERVATIONS} observations`,
    );
  }

  for (const observation of command.observations) {
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(observation.component)) {
      throw new StatusApplicationError("invalid_input", "Invalid component slug");
    }
    if (!VALID_STATUSES.has(observation.status)) {
      throw new StatusApplicationError("invalid_input", "Invalid component status");
    }
    if (observation.message !== undefined && observation.message.length > MAX_MESSAGE_LENGTH) {
      throw new StatusApplicationError(
        "invalid_input",
        `Message must not exceed ${MAX_MESSAGE_LENGTH} characters`,
      );
    }
  }
}

function normalizeMessage(message: string | undefined): string | null {
  const normalized = message?.trim();
  return normalized === undefined || normalized.length === 0 ? null : normalized;
}
