import type {
  ComponentGroupKey,
  DailyAvailabilityResponse,
  PublicComponentResponse,
  PublicGroupResponse,
  PublicIncidentResponse,
  PublicStatusResponse,
} from "../../../contracts/status-api";
import { calculateAvailability } from "../../domain/status/availability";
import type { StatusRepository } from "../../domain/status/status-repository";
import {
  deriveComponentStatus,
  deriveOutageStart,
  worstStatus,
} from "../../domain/status/status-policy";
import type {
  StatusComponent,
  StatusIncident,
  StoredComponentStatus,
} from "../../domain/status/types";

const DAY_SECONDS = 24 * 60 * 60;
const MONTH_SECONDS = 30 * DAY_SECONDS;
const QUARTER_SECONDS = 90 * DAY_SECONDS;
const GROUP_NAMES: Record<ComponentGroupKey, string> = {
  devices: "Device Status",
  k3s: "K3S Status",
};

export interface GetPublicStatusQuery {
  now: number;
}

export async function getPublicStatus(
  query: GetPublicStatusQuery,
  repository: StatusRepository,
): Promise<PublicStatusResponse> {
  const incidentSince = query.now - QUARTER_SECONDS;
  const data = await repository.getPublicStatusData(incidentSince);
  const incidentsByComponent = groupIncidents(data.incidents);
  const groupsByKey = new Map<ComponentGroupKey, PublicGroupResponse>();
  const publicIncidents: PublicIncidentResponse[] = [];

  for (const stored of data.components) {
    const componentIncidents = incidentsByComponent.get(stored.component.id) ?? [];
    const currentStatus = deriveComponentStatus(stored.component, stored.state, query.now);
    const virtualOutageStart =
      currentStatus === "outage" && stored.openIncidentId === null
        ? deriveOutageStart(stored.component, stored.state)
        : null;

    const componentResponse = toComponentResponse(
      stored,
      currentStatus,
      componentIncidents,
      virtualOutageStart,
      query.now,
    );
    const group = getOrCreateGroup(groupsByKey, stored.component.group);
    group.components.push(componentResponse);
    group.status = worstStatus([group.status, componentResponse.status]);

    if (virtualOutageStart !== null) {
      publicIncidents.push({
        id: `virtual:${stored.component.id}`,
        component: stored.component.slug,
        componentName: stored.component.name,
        startedAt: toIso(virtualOutageStart),
        endedAt: null,
        cause: stored.state?.reportedStatus === "outage" ? "reported" : "stale",
        summary: stored.state?.message ?? null,
      });
    }
  }

  const componentById = new Map(data.components.map((stored) => [stored.component.id, stored.component]));
  for (const incident of data.incidents) {
    const component = componentById.get(incident.componentId);
    if (component === undefined) {
      continue;
    }
    publicIncidents.push(toIncidentResponse(incident, component));
  }

  const groups = [...groupsByKey.values()];
  const overallStatus = worstStatus(groups.map((group) => group.status));

  publicIncidents.sort(
    (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
  );

  return {
    status: overallStatus,
    generatedAt: toIso(query.now),
    groups,
    incidents: publicIncidents.slice(0, 20),
  };
}

function groupIncidents(incidents: readonly StatusIncident[]): Map<number, StatusIncident[]> {
  const result = new Map<number, StatusIncident[]>();

  for (const incident of incidents) {
    const componentIncidents = result.get(incident.componentId);
    if (componentIncidents === undefined) {
      result.set(incident.componentId, [incident]);
    } else {
      componentIncidents.push(incident);
    }
  }

  return result;
}

function getOrCreateGroup(
  groups: Map<ComponentGroupKey, PublicGroupResponse>,
  key: ComponentGroupKey,
): PublicGroupResponse {
  const existing = groups.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const group: PublicGroupResponse = {
    key,
    name: GROUP_NAMES[key],
    status: "operational",
    components: [],
  };
  groups.set(key, group);
  return group;
}

function toComponentResponse(
  stored: StoredComponentStatus,
  currentStatus: PublicComponentResponse["status"],
  incidents: readonly StatusIncident[],
  virtualOutageStart: number | null,
  now: number,
): PublicComponentResponse {
  const { component, state } = stored;

  return {
    slug: component.slug,
    name: component.name,
    description: component.description,
    status: currentStatus,
    message: state?.message ?? null,
    lastReceivedAt: state === null ? null : toIso(state.receivedAt),
    availability: {
      day: calculateAvailability(
        component.monitoringStartedAt,
        incidents,
        now - DAY_SECONDS,
        now,
        virtualOutageStart,
      ),
      month: calculateAvailability(
        component.monitoringStartedAt,
        incidents,
        now - MONTH_SECONDS,
        now,
        virtualOutageStart,
      ),
      quarter: calculateAvailability(
        component.monitoringStartedAt,
        incidents,
        now - QUARTER_SECONDS,
        now,
        virtualOutageStart,
      ),
    },
    daily: buildDailyAvailability(component, incidents, virtualOutageStart, now),
  };
}

function buildDailyAvailability(
  component: StatusComponent,
  incidents: readonly StatusIncident[],
  virtualOutageStart: number | null,
  now: number,
): DailyAvailabilityResponse[] {
  const currentDayStart = Math.floor(now / DAY_SECONDS) * DAY_SECONDS;
  const daily: DailyAvailabilityResponse[] = [];

  for (let offset = 89; offset >= 0; offset -= 1) {
    const dayStart = currentDayStart - offset * DAY_SECONDS;
    const dayEnd = Math.min(dayStart + DAY_SECONDS, now);
    const availability = calculateAvailability(
      component.monitoringStartedAt,
      incidents,
      dayStart,
      dayEnd,
      virtualOutageStart,
    );
    daily.push({
      date: new Date(dayStart * 1000).toISOString().slice(0, 10),
      ...availability,
    });
  }

  return daily;
}

function toIncidentResponse(
  incident: StatusIncident,
  component: StatusComponent,
): PublicIncidentResponse {
  return {
    id: String(incident.id),
    component: component.slug,
    componentName: component.name,
    startedAt: toIso(incident.startedAt),
    endedAt: incident.endedAt === null ? null : toIso(incident.endedAt),
    cause: incident.cause,
    summary: incident.summary,
  };
}

function toIso(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString();
}
