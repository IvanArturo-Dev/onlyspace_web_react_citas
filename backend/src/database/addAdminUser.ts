import { prisma } from './prisma.service';
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

async function addAdminUser() {
  console.log('Creating admin user...');

  const password_hash = await bcrypt.hash('admin123', SALT_ROUNDS);

  const adminUser = await prisma.user.create({
    data: {
      id: 'admin-user-001',
      tenant_id: 'default',
      role_id: 'admin-role-default',
      name: 'Admin User',
      email: 'admin@citas.com',
      phone: '+525555555555',
      password_hash,
      avatar: null,
      is_active: true,
      last_login: new Date(),
    },
    include: {
      role: true,
      tenant: true,
    },
  });

  console.log('✅ Admin user created successfully');
  console.log('User:', adminUser.name);
  console.log('Email:', adminUser.email);
  console.log('Role:', adminUser.role?.name);
  console.log('\nLogin credentials:');
  console.log('Email: admin@citas.com');
  console.log('Password: admin123');
}

addAdminUser()
  .catch((e) => {
    console.error('Error creating admin user:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
