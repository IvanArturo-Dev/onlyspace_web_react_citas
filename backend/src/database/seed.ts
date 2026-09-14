import { prisma } from './prisma.service';

async function seed() {
  console.log(' seeding database...');

  // Create default tenant if not exists
  let tenant = await prisma.tenant.findUnique({
    where: { id: 'default' },
  });

  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        id: 'default',
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

  // Create default role
  const adminRole = await prisma.userRole.upsert({
    where: { id: 'admin-role-default' },
    update: {},
    create: {
      id: 'admin-role-default',
      tenant_id: 'default',
      name: 'ADMIN',
      description: 'Administrator with full access',
      permissions: JSON.stringify([
        'customers:read',
        'customers:write',
        'customers:delete',
        'services:read',
        'services:write',
        'services:delete',
        'appointments:read',
        'appointments:write',
        'appointments:cancel',
        'appointments:confirm',
        'dashboard:read',
        'users:read',
        'users:write',
        'users:delete',
        'settings:read',
        'settings:write',
        'audit:read',
      ]),
      is_active: true,
    },
  });

  const professionalRole = await prisma.userRole.upsert({
    where: { id: 'professional-role-default' },
    update: {},
    create: {
      id: 'professional-role-default',
      tenant_id: 'default',
      name: 'PROFESSIONAL',
      description: 'Professional user with limited access',
      permissions: JSON.stringify([
        'appointments:read',
        'appointments:write',
        'appointments:confirm',
        'dashboard:read',
      ]),
      is_active: true,
    },
  });

  const receptionRole = await prisma.userRole.upsert({
    where: { id: 'reception-role-default' },
    update: {},
    create: {
      id: 'reception-role-default',
      tenant_id: 'default',
      name: 'RECEPTION',
      description: 'Receptionist with basic access',
      permissions: JSON.stringify([
        'customers:read',
        'customers:write',
        'appointments:read',
        'appointments:write',
        'dashboard:read',
      ]),
      is_active: true,
    },
  });

  console.log(' ✅ Database seeded successfully');
  console.log('   - Tenant:', tenant.name);
  console.log('   - Roles created:', adminRole.name, professionalRole.name, receptionRole.name);
}

seed()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
