import { describe, it, expect, beforeEach, beforeAll, jest } from '@jest/globals';
import { HttpError } from '../../utils/errors';

// Mock Prisma
const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  userRole: {
    findUnique: jest.fn(),
  },
};

jest.mock('../../database/prisma.service', () => ({
  prisma: mockPrisma,
}));

// Mock bcrypt so hashing does not depend on native crypto timing
jest.mock('bcrypt', () => ({
  __esModule: true,
  default: {
    hash: jest.fn(async () => 'hashed-password'),
    compare: jest.fn(async () => true),
  },
}));

// Roles present in the mocked database
const SUPERADMIN_ROLE = {
  id: 'superadmin-role',
  name: 'SUPERADMIN',
  permissions: JSON.stringify([]),
};

const NORMAL_ROLE = {
  id: 'reception-role-default',
  name: 'RECEPTION',
  permissions: JSON.stringify([]),
};

// Import after mocks are registered
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { authService } = require('../../services/auth.service');

describe('authService.register - Property 3: no SUPERADMIN elevation from tenant flows', () => {
  beforeAll(() => {
    // register generates JWTs, which requires a secret
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Email does not exist so the flow reaches the role validation / create
    mockPrisma.user.findFirst.mockResolvedValue(null);

    mockPrisma.userRole.findUnique.mockImplementation(async (args: any) => {
      const id = args?.where?.id;
      if (id === SUPERADMIN_ROLE.id) return SUPERADMIN_ROLE;
      if (id === NORMAL_ROLE.id) return NORMAL_ROLE;
      return null;
    });

    // create resolves with a user (including the resolved role)
    mockPrisma.user.create.mockImplementation(async (args: any) => {
      const role = args?.data?.role_id === NORMAL_ROLE.id ? NORMAL_ROLE : null;
      return {
        id: 'new-user-id',
        name: args?.data?.name,
        email: args?.data?.email,
        tenant_id: args?.data?.tenant_id || 'default',
        role,
      };
    });
  });

  it('rejects register with role_id "superadmin-role" (403 FORBIDDEN_ROLE_ASSIGNMENT) and never creates the user', async () => {
    await expect(
      authService.register({
        email: 'attacker@example.com',
        password: 'password123',
        name: 'Attacker',
        role_id: 'superadmin-role',
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN_ROLE_ASSIGNMENT',
    });

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects register when role_id resolves to a role named SUPERADMIN and never creates the user', async () => {
    // A role_id that is not literally "superadmin-role" but resolves to a SUPERADMIN role
    mockPrisma.userRole.findUnique.mockResolvedValueOnce({
      id: 'aliased-super-role',
      name: 'SUPERADMIN',
      permissions: JSON.stringify([]),
    });

    await expect(
      authService.register({
        email: 'attacker2@example.com',
        password: 'password123',
        name: 'Attacker Two',
        role_id: 'aliased-super-role',
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      code: 'FORBIDDEN_ROLE_ASSIGNMENT',
    });

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('allows register with a normal role_id and creates the user', async () => {
    const result = await authService.register({
      email: 'user@example.com',
      password: 'password123',
      name: 'Normal User',
      role_id: NORMAL_ROLE.id,
    });

    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    expect(result.user.role).toBe('RECEPTION');
    expect(result.user.role).not.toBe('SUPERADMIN');
  });

  it('allows register without role_id and creates the user (no SUPERADMIN role)', async () => {
    const result = await authService.register({
      email: 'noRole@example.com',
      password: 'password123',
      name: 'No Role User',
    });

    // No role validation should be triggered
    expect(mockPrisma.userRole.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    expect(result.user.role).not.toBe('SUPERADMIN');
  });
});
