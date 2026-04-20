import { describe, it, expect } from "vitest";
import { getHealthStatus } from "../../../../web/routes/lib/health.ts";

describe("health", () => {
  it("returns health status object", async () => {
    const status = await getHealthStatus();
    expect(status).toHaveProperty("healthy");
    expect(status).toHaveProperty("status");
    expect(status).toHaveProperty("uptime");
    expect(status).toHaveProperty("checks");
    expect(status).toHaveProperty("wsClients");
    expect(status).toHaveProperty("sessions");
    expect(status).toHaveProperty("daemonRunning");
    expect(status).toHaveProperty("memory");
  });
});
