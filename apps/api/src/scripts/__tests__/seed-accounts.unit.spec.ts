import { getSeedAccountConfig } from "../seed-accounts";

describe("seed account config", () => {
  it("uses formal default emails and requires passwords", () => {
    expect(() =>
      getSeedAccountConfig({
        SEED_ADMIN_PASSWORD: "AdminPass123!",
        SEED_VENDOR_PASSWORD: "VendorPass123!",
      }),
    ).not.toThrow();

    const config = getSeedAccountConfig({
      SEED_ADMIN_PASSWORD: "AdminPass123!",
      SEED_VENDOR_PASSWORD: "VendorPass123!",
    });

    expect(config.admin.email).toBe("admin@emall-opc.com");
    expect(config.vendor.email).toBe("vendor@emall-opc.com");
  });

  it("allows account details to be overridden from the environment", () => {
    const config = getSeedAccountConfig({
      SEED_ADMIN_EMAIL: "ops@example.com",
      SEED_ADMIN_PASSWORD: "AdminPass123!",
      SEED_VENDOR_EMAIL: "seller@example.com",
      SEED_VENDOR_PASSWORD: "VendorPass123!",
      SEED_VENDOR_NAME: "Example Seller",
      SEED_VENDOR_HANDLE: "example-seller",
      SEED_VENDOR_CURRENCY: "eur",
    });

    expect(config.admin).toEqual({
      email: "ops@example.com",
      password: "AdminPass123!",
      firstName: "Admin",
      lastName: "User",
    });
    expect(config.vendor).toEqual({
      email: "seller@example.com",
      password: "VendorPass123!",
      firstName: "Vendor",
      lastName: "User",
      name: "Example Seller",
      handle: "example-seller",
      currencyCode: "eur",
    });
  });

  it("fails fast when required passwords are missing", () => {
    expect(() => getSeedAccountConfig({})).toThrow(
      "Missing required seed account password environment variables",
    );
  });
});
