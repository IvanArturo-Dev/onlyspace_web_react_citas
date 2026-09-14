import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { HttpError } from '../utils/errors';
import { isTokenBlocked } from '../utils/tokenStore';
import { AuthRequest } from '../types/express';

export const authMiddleware = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new HttpError('Unauthorized', 401, 'AUTH_REQUIRED');
    }

    const token = authHeader.split(' ')[1];

    // Check if token is blocked
    const isBlocked = await isTokenBlocked(token);
    if (isBlocked) {
      throw new HttpError('Token has been invalidated', 401, 'TOKEN_INVALIDATED');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new HttpError('JWT secret not configured', 500, 'JWT_SECRET_ERROR');
    }

    const decoded = jwt.verify(token, secret) as {
      user_id: string;
      tenant_id: string;
      role: string;
      permissions: string[];
      // Claim opcional de impersonacion (super admin actuando como el tenant).
      impersonated_by?: string;
      iat: number;
      exp: number;
    };

    req.user = {
      id: decoded.user_id,
      tenant_id: decoded.tenant_id,
      role: decoded.role,
      permissions: decoded.permissions,
      // Sera undefined cuando el token no incluya el claim (flujo normal).
      impersonated_by: decoded.impersonated_by,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new HttpError('Token expired', 401, 'TOKEN_EXPIRED');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new HttpError('Invalid token', 401, 'INVALID_TOKEN');
    }
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError('Unauthorized', 401, 'AUTH_REQUIRED');
  }
};
