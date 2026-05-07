import {
  ExecArgs,
  IAuthModuleService,
  IUserModuleService,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  FeatureFlag,
  Modules,
} from "@medusajs/framework/utils";
import { createSellerDefaultsWorkflow } from "@mercurjs/core/workflows";
import { MercurModules, SellerRole, SellerStatus } from "@mercurjs/types";

type SeedAccountEnv = Partial<
  Record<
    | "SEED_ADMIN_EMAIL"
    | "SEED_ADMIN_PASSWORD"
    | "SEED_VENDOR_EMAIL"
    | "SEED_VENDOR_PASSWORD"
    | "SEED_VENDOR_NAME"
    | "SEED_VENDOR_HANDLE"
    | "SEED_VENDOR_CURRENCY",
    string
  >
>;

type SeedAccountConfig = {
  admin: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  };
  vendor: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    name: string;
    handle: string;
    currencyCode: string;
  };
};

const getEnvValue = (
  env: SeedAccountEnv,
  key: keyof SeedAccountEnv,
  fallback?: string,
) => {
  const value = env[key]?.trim();

  return value || fallback || "";
};

export const getSeedAccountConfig = (
  env: SeedAccountEnv = process.env,
): SeedAccountConfig => {
  const adminPassword = getEnvValue(env, "SEED_ADMIN_PASSWORD");
  const vendorPassword = getEnvValue(env, "SEED_VENDOR_PASSWORD");
  const missingPasswords = [
    !adminPassword && "SEED_ADMIN_PASSWORD",
    !vendorPassword && "SEED_VENDOR_PASSWORD",
  ].filter(Boolean);

  if (missingPasswords.length) {
    throw new Error(
      `Missing required seed account password environment variables: ${missingPasswords.join(", ")}`,
    );
  }

  return {
    admin: {
      email: getEnvValue(env, "SEED_ADMIN_EMAIL", "admin@emall-opc.com"),
      password: adminPassword,
      firstName: "Admin",
      lastName: "User",
    },
    vendor: {
      email: getEnvValue(env, "SEED_VENDOR_EMAIL", "vendor@emall-opc.com"),
      password: vendorPassword,
      firstName: "Vendor",
      lastName: "User",
      name: getEnvValue(env, "SEED_VENDOR_NAME", "Emall OPC Vendor"),
      handle: getEnvValue(env, "SEED_VENDOR_HANDLE", "emall-opc-vendor"),
      currencyCode: getEnvValue(
        env,
        "SEED_VENDOR_CURRENCY",
        "usd",
      ).toLowerCase(),
    },
  };
};

const ensureEmailPassAuthIdentity = async (
  authModule: IAuthModuleService,
  input: {
    email: string;
    password: string;
    appMetadata: Record<string, string>;
  },
) => {
  const authWithProviderService = authModule as IAuthModuleService & {
    getAuthIdentityProviderService: (provider: string) => {
      retrieve: (input: { entity_id: string }) => Promise<{ id: string }>;
    };
  };
  const registerResult = await authModule.register("emailpass", {
    body: {
      email: input.email,
      password: input.password,
    },
  });

  let authIdentity = registerResult.authIdentity;

  if (registerResult.error) {
    const updateResult = await authModule.updateProvider("emailpass", {
      entity_id: input.email,
      password: input.password,
    });

    if (updateResult.error) {
      throw new Error(updateResult.error);
    }

    authIdentity = updateResult.authIdentity;
  }

  if (!authIdentity?.id) {
    const provider =
      authWithProviderService.getAuthIdentityProviderService("emailpass");
    authIdentity = await provider.retrieve({ entity_id: input.email });
  }

  if (!authIdentity?.id) {
    throw new Error(
      `Unable to resolve emailpass auth identity for ${input.email}`,
    );
  }

  await authModule.updateAuthIdentities({
    id: authIdentity.id,
    app_metadata: input.appMetadata,
  });

  return authIdentity;
};

const ignoreExistingLink = (error: unknown) => {
  if (error instanceof Error && error.message.includes("already")) {
    return;
  }

  throw error;
};

const ensureAdminAccount = async (
  container: ExecArgs["container"],
  config: SeedAccountConfig["admin"],
) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const userModule = container.resolve<IUserModuleService>(Modules.USER);
  const authModule = container.resolve<IAuthModuleService>(Modules.AUTH);

  const existingUsers = await userModule.listUsers({ email: config.email });
  let user = existingUsers[0];

  if (!user) {
    user = await userModule.createUsers({
      email: config.email,
      first_name: config.firstName,
      last_name: config.lastName,
    });
    logger.info(`Created admin user ${config.email}.`);
  } else {
    logger.info(
      `Admin user ${config.email} already exists, updating password and permissions.`,
    );
  }

  await ensureEmailPassAuthIdentity(authModule, {
    email: config.email,
    password: config.password,
    appMetadata: {
      user_id: user.id,
    },
  });

  if (!FeatureFlag.isFeatureEnabled("rbac")) {
    return user;
  }

  const rbacModule = container.resolve(Modules.RBAC);
  const superAdminRoles = await rbacModule.listRbacRoles({
    id: "role_super_admin",
  });

  if (!superAdminRoles.length) {
    logger.warn(
      "RBAC is enabled, but role_super_admin does not exist. Skipping admin role link.",
    );
    return user;
  }

  try {
    await link.create({
      [Modules.USER]: {
        user_id: user.id,
      },
      [Modules.RBAC]: {
        rbac_role_id: superAdminRoles[0].id,
      },
    });
  } catch (error) {
    ignoreExistingLink(error);
  }

  return user;
};

const ensureVendorAccount = async (
  container: ExecArgs["container"],
  config: SeedAccountConfig["vendor"],
) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const authModule = container.resolve<IAuthModuleService>(Modules.AUTH);
  const sellerModule = container.resolve<any>(MercurModules.SELLER);

  await createSellerDefaultsWorkflow(container).run({});

  const existingSellers = await sellerModule.listSellers({
    email: config.email,
  });
  let seller = existingSellers[0];

  if (!seller) {
    seller = await sellerModule.createSellers({
      name: config.name,
      handle: config.handle,
      email: config.email,
      currency_code: config.currencyCode,
      status: SellerStatus.OPEN,
    });
    logger.info(`Created vendor seller ${config.email}.`);
  } else {
    seller = await sellerModule.updateSellers({
      id: seller.id,
      name: seller.name || config.name,
      handle: seller.handle || config.handle,
      currency_code: seller.currency_code || config.currencyCode,
      status: SellerStatus.OPEN,
    });
    logger.info(
      `Vendor seller ${config.email} already exists, updating password and permissions.`,
    );
  }

  const [member] = await sellerModule.upsertMembers([
    {
      email: config.email,
      first_name: config.firstName,
      last_name: config.lastName,
    },
  ]);

  const sellerMembers = await sellerModule.listSellerMembers({
    seller_id: seller.id,
    member_id: member.id,
  });

  if (!sellerMembers.length) {
    await sellerModule.createSellerMembers({
      seller_id: seller.id,
      member_id: member.id,
      role_id: SellerRole.SELLER_ADMINISTRATION,
      is_owner: true,
    });
  } else {
    await sellerModule.updateSellerMembers({
      id: sellerMembers[0].id,
      role_id: SellerRole.SELLER_ADMINISTRATION,
      is_owner: true,
    });
  }

  await ensureEmailPassAuthIdentity(authModule, {
    email: config.email,
    password: config.password,
    appMetadata: {
      member_id: member.id,
    },
  });

  return { seller, member };
};

export const seedAccounts = async ({ container }: ExecArgs) => {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const config = getSeedAccountConfig();

  logger.info("Seeding formal admin and vendor accounts...");

  const admin = await ensureAdminAccount(container, config.admin);
  const vendor = await ensureVendorAccount(container, config.vendor);

  logger.info(`Seeded admin account: ${admin.email}`);
  logger.info(`Seeded vendor account: ${vendor.seller.email}`);
  logger.info("Finished seeding formal accounts.");
};

export default seedAccounts;
