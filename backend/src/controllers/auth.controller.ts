import { Response } from 'express';
import { AuthRequest } from '../types/express';
import { authService } from '../services/auth.service';
import { googleOAuthService } from '../services/google-oauth.service';
import { firebaseAdminService } from '../services/firebase-admin.service';
import { appleOAuthService } from '../services/apple-oauth.service';
import { generateAccessToken, generateRefreshToken } from '../config/jwt';
import { storeRefreshToken } from '../utils/tokenStore';
import { prisma } from '../database/prisma.service';
import { writeAudit } from '../utils/audit';
import { resolveLoginRole } from '../services/loginRole.service';
import crypto from 'crypto';

export const authController = {
  async login(req: AuthRequest, res: Response): Promise<void> {
    const { email, password } = req.body;
    const deviceId = req.headers['x-device-id'] as string;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email and password are required',
        },
      });
      return;
    }

    try {
      const result = await authService.login(email, password, deviceId);
      res.status(200).json(result);
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async register(req: AuthRequest, res: Response): Promise<void> {
    const { email, password, name, tenant_id, role_id } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email, password, and name are required',
        },
      });
      return;
    }

    try {
      const result = await authService.register({
        email,
        password,
        name,
        tenant_id,
        role_id,
      });
      res.status(201).json(result);
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async refreshToken(req: AuthRequest, res: Response): Promise<void> {
    const { refresh_token } = req.body;
    const deviceId = req.headers['x-device-id'] as string;

    if (!refresh_token) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Refresh token is required',
        },
      });
      return;
    }

    try {
      const result = await authService.refreshToken(refresh_token, deviceId || '');
      res.status(200).json(result);
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async logout(req: AuthRequest, res: Response): Promise<void> {
    const userId = req.user?.id;
    const tenantId = req.user?.tenant_id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Unauthorized',
        },
      });
      return;
    }

    try {
      await authService.logout(userId, '', tenantId || '');
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async forgotPassword(req: AuthRequest, res: Response): Promise<void> {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Email is required',
        },
      });
      return;
    }

    try {
      const result = await authService.forgotPassword(email);
      res.status(200).json(result);
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async resetPassword(req: AuthRequest, res: Response): Promise<void> {
    const { token, new_password } = req.body;

    if (!token || !new_password) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Token and new password are required',
        },
      });
      return;
    }

    try {
      const result = await authService.resetPassword(token, new_password);
      res.status(200).json(result);
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getMe(req: AuthRequest, res: Response): Promise<void> {
    try {
      const user = await authService.getMe(req.user!.id);
      res.status(200).json({ success: true, data: user });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async googleLogin(req: AuthRequest, res: Response): Promise<void> {
    const { code } = req.body;
    const deviceId = req.headers['x-device-id'] as string;

    if (!code) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Authorization code is required',
        },
      });
      return;
    }

    try {
      const tokenResponse = await googleOAuthService.exchangeCodeForToken(code);
      const profile = await googleOAuthService.getProfile(tokenResponse.access_token);

      // Auto-register user if doesn't exist
      let userRecord = await prisma.user.findUnique({
        where: { email: profile.email },
      });

      if (!userRecord) {
        userRecord = await prisma.user.create({
          data: {
            name: profile.name,
            email: profile.email,
            password_hash: 'oauth-google',
            avatar: profile.picture ?? null,
            is_active: true,
            tenant_id: 'default',
            role_id: null,
          },
        });
      }

      const permissions: string[] = [];

      const accessTokenJwt = generateAccessToken({
        user_id: userRecord.id,
        tenant_id: userRecord.tenant_id,
        role: 'RECEPTION',
        permissions,
      });

      const refreshToken = generateRefreshToken(userRecord.id);
      await storeRefreshToken(userRecord.id, refreshToken, deviceId || '');

      res.status(200).json({
        user: {
          id: userRecord.id,
          name: userRecord.name,
          email: userRecord.email,
          avatar: userRecord.avatar,
          role: 'RECEPTION',
          permissions,
        },
        access_token: accessTokenJwt,
        refresh_token: refreshToken,
        google_access_token: tokenResponse.access_token,
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async firebaseGoogleLogin(req: AuthRequest, res: Response): Promise<void> {
    const { id_token } = req.body;
    const deviceId = req.headers['x-device-id'] as string;

    if (!id_token) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'ID token is required',
        },
      });
      return;
    }

    try {
      const profile = await firebaseAdminService.verifyIdToken(id_token);

      // Restrict access to Google/Gmail accounts. We do NOT require a specific
      // @gmail.com domain because Google Workspace accounts are also valid
      // Google accounts; a verified email is sufficient proof of a Google
      // identity (verifyFirebaseIdToken already enforces email_verified).
      if (!profile.email) {
        res.status(401).json({
          success: false,
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'A verified Google email is required',
          },
        });
        return;
      }

      // Determine the effective role and tenant from the authorization
      // whitelist. This is the single source of truth for ADMIN/CLIENT:
      // ADMIN is granted only if the email is an active AuthorizedAdmin,
      // SUPERADMIN only if it matches the configured super admin email, and
      // everyone else is a CLIENT. No request data can force ADMIN (Property 1).
      const { role, tenant_id: resolvedTenantId } = await resolveLoginRole(
        profile.email
      );

      // Look up the user by email.
      let userRecord = await prisma.user.findUnique({
        where: { email: profile.email },
      });

      // Auto-register the user on first Google login, placing them in the
      // tenant resolved for their role (their own tenant for ADMIN, 'default'
      // for SUPERADMIN/CLIENT).
      if (!userRecord) {
        userRecord = await prisma.user.create({
          data: {
            name: profile.name,
            email: profile.email,
            password_hash: 'oauth-google',
            avatar: profile.picture ?? null,
            is_active: true,
            tenant_id: resolvedTenantId,
            role_id: null,
          },
        });
      } else if (userRecord.tenant_id !== resolvedTenantId) {
        // Reconcile the user's tenant with the one resolved for their role.
        // This keeps an ADMIN pinned to their own tenant even if the user row
        // previously carried a different tenant_id.
        userRecord = await prisma.user.update({
          where: { id: userRecord.id },
          data: { tenant_id: resolvedTenantId },
        });
      }

      // Permissions are empty here; SUPERADMIN authorization is enforced by
      // role name in its guard, not by permissions.
      const permissions: string[] = [];

      // Update last login timestamp.
      await prisma.user.update({
        where: { id: userRecord.id },
        data: { last_login: new Date() },
      });

      const accessTokenJwt = generateAccessToken({
        user_id: userRecord.id,
        tenant_id: userRecord.tenant_id,
        role,
        permissions,
      });

      const refreshToken = generateRefreshToken(userRecord.id);
      await storeRefreshToken(userRecord.id, refreshToken, deviceId || '');

      // Best-effort audit log of the login event.
      await writeAudit({
        tenant_id: userRecord.tenant_id,
        user_id: userRecord.id,
        action: 'LOGIN',
        resource_type: 'user',
        resource_id: userRecord.id,
        result: 'success',
        ip_address: req.ip,
        user_agent: req.headers['user-agent'],
      });

      res.status(200).json({
        user: {
          id: userRecord.id,
          name: userRecord.name,
          email: userRecord.email,
          avatar: userRecord.avatar,
          role,
          permissions,
        },
        access_token: accessTokenJwt,
        refresh_token: refreshToken,
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getGoogleAuthUrl(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = googleOAuthService.getAuthorizationUrl(state);
      res.status(200).json({ auth_url: authUrl, state });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: {
          code: error.code || 'GOOGLE_OAUTH_ERROR',
          message: error.message || 'Failed to get Google auth URL',
        },
      });
    }
  },

  async appleLogin(req: AuthRequest, res: Response): Promise<void> {
    const { code, id_token } = req.body;
    const deviceId = req.headers['x-device-id'] as string;

    if (!code && !id_token) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Authorization code or ID token is required',
        },
      });
      return;
    }

    try {
      let profile: any;

      if (id_token) {
        profile = await appleOAuthService.getProfile(id_token);
      } else if (code) {
        const tokenResponse = await appleOAuthService.exchangeCodeForToken(code);
        profile = await appleOAuthService.getProfile(tokenResponse.id_token);
      } else {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_REQUEST',
            message: 'Invalid request',
          },
        });
        return;
      }

      let userRecord = await prisma.user.findUnique({
        where: { email: profile.email },
      });

      if (!userRecord) {
        const name = profile.name?.firstName && profile.name?.lastName
          ? `${profile.name.firstName} ${profile.name.lastName}`
          : profile.email.split('@')[0];

        userRecord = await prisma.user.create({
          data: {
            name,
            email: profile.email,
            password_hash: 'oauth-apple',
            is_active: true,
            tenant_id: 'default',
            role_id: null,
          },
        });
      }

      const permissions: string[] = [];

      const accessTokenJwt = generateAccessToken({
        user_id: userRecord.id,
        tenant_id: userRecord.tenant_id,
        role: 'RECEPTION',
        permissions,
      });

      const refreshToken = generateRefreshToken(userRecord.id);
      await storeRefreshToken(userRecord.id, refreshToken, deviceId || '');

      res.status(200).json({
        user: {
          id: userRecord.id,
          name: userRecord.name,
          email: userRecord.email,
          role: 'RECEPTION',
          permissions,
        },
        access_token: accessTokenJwt,
        refresh_token: refreshToken,
      });
    } catch (error: any) {
      if (error.statusCode) {
        res.status(error.statusCode).json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
        return;
      }
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
        },
      });
    }
  },

  async getAppleAuthUrl(_req: AuthRequest, res: Response): Promise<void> {
    try {
      const state = crypto.randomBytes(16).toString('hex');
      const authUrl = appleOAuthService.getAuthorizationUrl(state);
      res.status(200).json({ auth_url: authUrl, state });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: {
          code: error.code || 'APPLE_OAUTH_ERROR',
          message: error.message || 'Failed to get Apple auth URL',
        },
      });
    }
  },
};


