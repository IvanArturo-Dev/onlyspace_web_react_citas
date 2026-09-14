import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        tenant_id: string;
        role: string;
        permissions: string[];
        // Presente solo bajo impersonacion: userId del super admin que actua como este tenant.
        impersonated_by?: string;
      };
      tenantId?: string;
    }
  }
}

export type AuthRequest = Request;

export {};
