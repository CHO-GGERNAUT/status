import useSWR from "swr";
import type { PublicStatusResponse } from "../contracts/status-api";
import { IncidentList } from "./components/incident-list";
import { StatusGroup } from "./components/status-group";

const STATUS_COPY = {
  operational: {
    eyebrow: "All systems operational",
    title: "Everything is running smoothly.",
    description: "Live availability across Ggernaut infrastructure.",
  },
  degraded: {
    eyebrow: "Partial degradation",
    title: "Some systems need attention.",
    description: "Core availability remains online while a component is degraded.",
  },
  outage: {
    eyebrow: "Service disruption",
    title: "One or more systems are unavailable.",
    description: "Recovery status will update automatically after the next heartbeat.",
  },
} as const;

async function fetchStatus(url: string): Promise<PublicStatusResponse> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Status API returned ${response.status}`);
  }
  return response.json() as Promise<PublicStatusResponse>;
}

export function StatusApp() {
  const { data, error, isLoading } = useSWR<PublicStatusResponse>(
    "/api/v1/status",
    fetchStatus,
    {
      refreshInterval: 60_000,
      dedupingInterval: 10_000,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  if (isLoading && data === undefined) {
    return <LoadingState />;
  }

  if (error !== undefined || data === undefined) {
    return <UnavailableState />;
  }

  const copy = STATUS_COPY[data.status];

  return (
    <div className="site-shell">
      <header className={`hero hero--${data.status}`}>
        <nav className="topbar" aria-label="Primary navigation">
          <a className="brand" href="#top" aria-label="Ggernaut Status home">
            <span className="brand__mark" aria-hidden="true">
              G
            </span>
            <span>Ggernaut Status</span>
          </a>
          <div className="topbar__links">
            <a href="#devices">Devices</a>
            <a href="#k3s">K3S</a>
            <a href="#incidents">Incidents</a>
          </div>
        </nav>

        <div className="hero__content" id="top">
          <div className="hero__signal" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="hero__description">{copy.description}</p>
          <p className="hero__timestamp">
            Last updated <time dateTime={data.generatedAt}>{formatTime(data.generatedAt)}</time>
          </p>
        </div>
      </header>

      <main>
        <div className="status-groups">
          {data.groups.map((group) => (
            <StatusGroup key={group.key} group={group} />
          ))}
        </div>
        <IncidentList incidents={data.incidents} />
      </main>

      <footer>
        <span>Ggernaut infrastructure</span>
        <span>Updated every minute</span>
      </footer>
    </div>
  );
}

function LoadingState() {
  return (
    <main className="centered-state" aria-live="polite">
      <div className="loading-orbit" aria-hidden="true" />
      <p className="eyebrow">Connecting</p>
      <h1>Loading system status…</h1>
    </main>
  );
}

function UnavailableState() {
  return (
    <main className="centered-state centered-state--error" role="alert">
      <span className="status-dot status-dot--outage" aria-hidden="true" />
      <p className="eyebrow">Status unavailable</p>
      <h1>The status API could not be reached.</h1>
      <p>This page will retry automatically in one minute.</p>
    </main>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}
