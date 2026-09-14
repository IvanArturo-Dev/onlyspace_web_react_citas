import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import bcrypt from 'bcrypt';
import { HttpError } from '../../src/utils/errors';
import { generateAccessToken, generateRefreshToken, verifyAccessToken } from '../../src/config/jwt';

// Mock Prisma
const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  device: {
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  auditLog: {
    create: jest.fn(),
  },
  role: {
    findUnique: jest.fn(),
  },
  tenant: {
    findUnique: jest.fn(),
  },
};

// Mock dependencies
jest.mock('../../src/database/prisma.service', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../src/utils/tokenStore', () => ({
  storeRefreshToken: jest.fn(),
  getRefreshToken: jest.fn(),
  deleteAllRefreshTokens: jest.fn(),
  invalidateToken: jest.fn(),
  isTokenBlocked: jest.fn().mockResolvedValue(false),
}));

describe('AuthService', () => {
  describe('hashPassword', () => {
    it('should hash password correctly', async () => {
      const password = 'test-password-123';
      const hash = await bcrypt.hash(password, 12);
      expect(hash).not.toBe(password);
      expect(hash).toHaveLength(60); // bcrypt hash length
    });
  });

  describe('comparePassword', () => {
    it('should return true for correct password', async () => {
      const password = 'test-password-123';
      const hash = await bcrypt.hash(password, 12);
      const isMatch = await bcrypt.compare(password, hash);
      expect(isMatch).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const password = 'test-password-123';
      const wrongPassword = 'wrong-password';
      const hash = await bcrypt.hash(password, 12);
      const isMatch = await bcrypt.compare(wrongPassword, hash);
      expect(isMatch).toBe(false);
    });
  });

  describe('JWT Token Generation', () => {
    const payload = {
      user_id: 'user-123',
      tenant_id: 'tenant-123',
      role: 'ADMIN',
      permissions: ['appointment.create', 'appointment.read'],
    };

    it('should generate valid access token', () => {
      const token = generateAccessToken(payload);
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT has 3 parts

      // Verify token
      const verified = verifyAccessToken(token);
      expect(verified.user_id).toBe(payload.user_id);
      expect(verified.tenant_id).toBe(payload.tenant_id);
    });

    it('should generate valid refresh token', () => {
      const token = generateRefreshToken('user-123');
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3);
    });

    it('should throw error if JWT_SECRET is not configured', () => {
      const originalEnv = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => generateAccessToken(payload)).toThrow();

      process.env.JWT_SECRET = originalEnv;
    });
  });
});
