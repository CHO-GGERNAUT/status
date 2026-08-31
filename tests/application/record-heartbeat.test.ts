import { describe, expect, it } from "vitest";
import { recordHeartbeat } from "../../src/server/application/status/record-heartbeat";
import type { ReporterAuthenticator } from "../../src/server/domain/status/reporter-authenticator";
import type { StatusRepository } from "../../src/server/domain/status/status-repository";
import type {
  PersistHeartbeat,
  PublicStatusData,
  StoredComponentStatus,
} from "../../src/server/domain/status/types";

class FakeAuthenticator implements ReporterAuthenticator {
  async authenticate() {
    return {
      id: "main-host",
      lastSequence: 10,
      allowedComponentSlugs: new Set(["ubuntu-main-server"]),
    };
  }
}

class FakeStatusRepository implements StatusRepository {
  persisted: PersistHeartbeat | null = null;

  async findComponentStatuses(): Promise<StoredComponentStatus[]> {
    return [
      {
        component: {
          id: 1,
          slug: "ubuntu-main-server",
          group: "devices",
          name: "Main Server",
          description: null,
          staleAfterSeconds: 180,
          sortOrder: 10,
          monitoringStartedAt: 1,
        },
        state: {
          componentId: 1,
          reportedStatus: "operational",
          message: null,
          observedAt: null,
          receivedAt: 100,
          reporterId: "main-host",
          sequence: 10,
        },
        openIncidentId: null,
      },
    ];
  }

  async persistHeartbeat(heartbeat: PersistHeartbeat): Promise<void> {
    this.persisted = heartbeat;
  }

  async getPublicStatusData(): Promise<PublicStatusData> {
    return { components: [], incidents: [] };
  }
}

describe("recordHeartbeat", () => {
  it("persists an authorized component heartbeat", async () => {
    const repository = new FakeStatusRepository();

    const result = await recordHeartbeat(
      {
        bearerToken: "main-host.secret",
        sequence: 11,
        observations: [
          {
            component: "ubuntu-main-server",
            status: "operational",
            message: " healthy ",
          },
        ],
        receivedAt: 200,
      },
      { authenticator: new FakeAuthenticator(), repository },
    );

    expect(result.acceptedComponents).toBe(1);
    expect(repository.persisted?.mutations[0]?.message).toBe("healthy");
  });

  it("rejects a reporter attempting to update another component", async () => {
    await expect(
      recordHeartbeat(
        {
          bearerToken: "main-host.secret",
          sequence: 11,
          observations: [{ component: "opnsense", status: "operational" }],
          receivedAt: 200,
        },
        { authenticator: new FakeAuthenticator(), repository: new FakeStatusRepository() },
      ),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
});
