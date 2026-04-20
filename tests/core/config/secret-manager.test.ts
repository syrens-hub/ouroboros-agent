import { describe, it, expect } from "vitest";
import { getSecret, resetSecretManager } from "../../../core/config/secret-manager.ts";

describe("secret-manager", () => {
  it("reads from environment by default", async () => {
    process.env.TEST_SECRET_KEY = "hello-world";
    const value = await getSecret("TEST_SECRET_KEY");
    expect(value).toBe("hello-world");
    delete process.env.TEST_SECRET_KEY;
  });

  it("returns undefined for missing key", async () => {
    const value = await getSecret("NON_EXISTENT_KEY_12345");
    expect(value).toBeUndefined();
  });

  it("supports vault backend stub", async () => {
    process.env.SECRET_BACKEND = "vault";
    process.env.VAULT_TOKEN = "";
    resetSecretManager();
    const value = await getSecret("ANY_KEY");
    expect(value).toBeUndefined();
    delete process.env.SECRET_BACKEND;
    delete process.env.VAULT_TOKEN;
    resetSecretManager();
  });
});
