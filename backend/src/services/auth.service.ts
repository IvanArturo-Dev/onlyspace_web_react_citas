import bcrypt from 'bcrypt';
import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';
import {
  generateAccessToken,
  generateRefreshToken,
} from '../config/jwt';
import {
  storeRefreshToken,
  getRefreshToken,
  deleteAllRefreshTokens,
  isTokenBlocked,
} from '../utils/tokenStore';
import jwt from 'jsonwebtoken';

const SALT_ROUNDS = 12;

export const authService = {
  async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  },

  async comparePassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  },

  async login(email: string, password: string, deviceId: string) {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
      include: {
        role: true,
        tenant: true,
      },
    });

    if (!user) {
      throw new HttpError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
      throw new HttpError('Account is disabled', 403, 'ACCOUNT_DISABLED');
    }

    // Verify password
    const isPasswordValid = await this.comparePassword(password, user.password_hash);
    if (!isPasswordValid) {
      throw new HttpError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { last_login: new Date() },
    });

    // Get user permissions
    const permissionsRaw = user.role?.permissions as any;
    const permissions = Array.isArray(permissionsRaw) ? permissionsRaw : [];

    // Generate tokens
    const accessToken = generateAccessToken({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role?.name || 'RECEPTION',
      permissions,
    });

    const refreshToken = generateRefreshToken(user.id);

    // Store refresh token
    await storeRefreshToken(user.id, refreshToken, deviceId);

    // Create audit log
    await prisma.auditLog.create({
      data: {
        tenant_id: user.tenant_id,
        user_id: user.id,
        action: 'LOGIN',
        resource_type: 'user',
        resource_id: user.id,
        result: 'success',
      },
    });

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name,
        permissions,
      },
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  },

  async register(data: {
    email: string;
    password: string;
    name: string;
    tenant_id?: string;
    role_id?: string;
  }) {
    const { email, password, name, tenant_id, role_id } = data;

    // Check if email already exists
    const existingUser = await prisma.user.findFirst({
      where: { email },
    });

    if (existingUser) {
      throw new HttpError('Email already exists', 409, 'EMAIL_EXISTS');
    }

    // Prevent privilege escalation: the SUPERADMIN role can only be assigned
    // via the seed/admin script, never through normal tenant register flows.
    if (role_id) {
      if (role_id === 'superadmin-role') {
        throw new HttpError('Cannot assign SUPERADMIN role', 403, 'FORBIDDEN_ROLE_ASSIGNMENT');
      }

      const role = await prisma.userRole.findUnique({
        where: { id: role_id },
      });

      if (role && role.name === 'SUPERADMIN') {
        throw new HttpError('Cannot assign SUPERADMIN role', 403, 'FORBIDDEN_ROLE_ASSIGNMENT');
      }
    }

    // Hash password
    const password_hash = await this.hashPassword(password);

    // Create user
    const user = await prisma.user.create({
      data: {
        name,
        email,
        password_hash,
        tenant_id: tenant_id || 'default',
        role_id,
      },
      include: { role: true },
    });

    // Get user permissions
    const permissionsRaw = user.role?.permissions as any;
    const permissions = Array.isArray(permissionsRaw) ? permissionsRaw : [];

    // Generate tokens
    const accessToken = generateAccessToken({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role?.name || 'RECEPTION',
      permissions,
    });

    const refreshToken = generateRefreshToken(user.id);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name,
        permissions,
      },
      access_token: accessToken,
      refresh_token: refreshToken,
    };
  },

  async refreshToken(refreshToken: string, deviceId: string) {
    // Verify refresh token
    const { user_id } = await this.verifyRefreshToken(refreshToken);

    // Check if token is blocked
    const isBlocked = await isTokenBlocked(refreshToken);
    if (isBlocked) {
      throw new HttpError('Token has been invalidated', 401, 'TOKEN_INVALIDATED');
    }

    // Get stored refresh token
    const storedToken = await getRefreshToken(user_id, deviceId);
    if (!storedToken || storedToken !== refreshToken) {
      throw new HttpError('Invalid refresh token', 401, 'INVALID_REFRESH_TOKEN');
    }

    // Get user
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      include: { role: true, tenant: true },
    });

    if (!user) {
      throw new HttpError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Get user permissions
    const permissionsRaw = user.role?.permissions as any;
    const permissions = Array.isArray(permissionsRaw) ? permissionsRaw : [];

    // Generate new tokens
    const newAccessToken = generateAccessToken({
      user_id: user.id,
      tenant_id: user.tenant_id,
      role: user.role?.name || 'RECEPTION',
      permissions,
    });

    const newRefreshToken = generateRefreshToken(user.id);

    // Rotate refresh token
    await deleteAllRefreshTokens(user_id);
    await storeRefreshToken(user_id, newRefreshToken, deviceId);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role?.name,
        permissions,
      },
      access_token: newAccessToken,
      refresh_token: newRefreshToken,
    };
  },

  async logout(userId: string, deviceId: string, tenantId: string) {
    // Delete refresh token
    await deleteAllRefreshTokens(userId);

    // Audit log
    await prisma.auditLog.create({
      data: {
        tenant_id: tenantId,
        user_id: userId,
        action: 'LOGOUT',
        resource_type: 'user',
        resource_id: userId,
        result: 'success',
      },
    });

    // Update device status
    await prisma.device.updateMany({
      where: { user_id: userId, device_id: deviceId },
      data: { is_active: false },
    });

    return { message: 'Logged out successfully' };
  },

  async forgotPassword(email: string) {
    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new HttpError('If email exists, reset link will be sent', 200, 'EMAIL_SENT');
    }

    // TODO: Send reset password email with token
    // This would require email service configuration

    return { message: 'Reset link sent if email exists' };
  },

  async resetPassword(_token: string, _newPassword: string) {
    // TODO: Verify reset token and update password
    // This would require email service configuration

    return { message: 'Password reset successfully' };
  },

  async getMe(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) {
      throw new HttpError('User not found', 404, 'USER_NOT_FOUND');
    }

    // Get user permissions
    const permissionsRaw = user.role?.permissions as any;
    const permissions = Array.isArray(permissionsRaw) ? permissionsRaw : [];

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: user.role?.name,
      permissions,
    };
  },

  async verifyRefreshToken(token: string) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new HttpError('JWT_SECRET is not configured', 500, 'JWT_SECRET_ERROR');
    }

    return jwt.verify(token, secret) as { user_id: string };
  },
};
