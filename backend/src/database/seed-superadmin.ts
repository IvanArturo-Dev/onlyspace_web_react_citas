import bcrypt from 'bcrypt';
import { prisma } from './prisma.service';

const SALT_ROUNDS = 12;

const SUPERADMIN_ROLE_ID = 'superadmin-role';
const DEFAULT_TENANT_ID = 'default';
const DEFAULT_SUPERADMIN_EMAIL = 'xcode.arturo@gmail.com';

/**
 * Idempotent seed for the global SUPERADMIN role and user.
 *
 * - Ensures the `default` tenant exists (creates it if missing).
 * - Upserts the SUPERADMIN role. Authorization depends only on the role `name`,
 *   not on `permissions`, so permissions is an empty array.
 * - Reads SUPERADMIN_EMAIL (default `xcode.arturo@gmail.com`) and SUPERADMIN_PASSWORD
 *   from the environment. Aborts if the password is missing.
 * - Creates the super user if it does not exist (bcrypt hashed password) or
 *   updates its role to SUPERADMIN if it already exists.
 *
 * Running this multiple times results in exactly one consistent super user.
 */
export async function seedSuperAdmin(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL || DEFAULT_SUPERADMIN_EMAIL;
  const password = process.env.SUPERADMIN_PASSWORD;

  if (!password) {
    console.error(
      '❌ SUPERADMIN_PASSWORD is not defined. Set it in your environment before running this seed.'
    );
    process.exit(1);
    return;
  }

  console.log(' seeding superadmin...');

  // Ensure the default tenant exists (same pattern as seed.ts)
  let tenant = await prisma.tenant.findUnique({
    where: { id: DEFAULT_TENANT_ID },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: DEFAULT_TENANT_ID,
        name: 'Default Tenant',
        subdomain: 'default',
        domain: null,
        status: 'active',
      },
    });
    console.log(' ✅ Default tenant created');
  } else {
    console.log(' ✅ Default tenant already exists');
  }

  // Upsert the SUPERADMIN role. Authorization is based on the role name only.
  const superAdminRole = await prisma.userRole.upsert({
    where: { id: SUPERADMIN_ROLE_ID },
    update: {
      tenant_id: DEFAULT_TENANT_ID,
      name: 'SUPERADMIN',
      description: 'Global super administrator with cross-tenant observability access',
      is_active: true,
    },
    create: {
      id: SUPERADMIN_ROLE_ID,
      tenant_id: DEFAULT_TENANT_ID,
      name: 'SUPERADMIN',
      description: 'Global super administrator with cross-tenant observability access',
      permissions: JSON.stringify([]),
      is_active: true,
    },
  });

  // Find the user by email. Update its role if it exists, otherwise create it.
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { role_id: superAdminRole.id },
    });
    console.log(` ✅ Existing user promoted to SUPERADMIN: ${email}`);
  } else {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await prisma.user.create({
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        role_id: superAdminRole.id,
        name: 'Super Admin',
        email,
        password_hash: passwordHash,
        is_active: true,
      },
    });
    console.log(` ✅ Superadmin user created: ${email}`);
  }

  console.log(' ✅ Superadmin seeded successfully');
}

// Execute as a script when run directly.
if (require.main === module) {
  seedSuperAdmin()
    .catch((e) => {
      console.error('Error seeding superadmin:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
