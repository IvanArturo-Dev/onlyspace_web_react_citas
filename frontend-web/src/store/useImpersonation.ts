import { create } from "zustand";
import {
  clearImpersonation,
  getImpersonationName,
  getImpersonationTenantId,
  getImpersonationToken,
  setImpersonation,
} from "../services/impersonation.service";

// Store liviano para que el banner de impersonacion reaccione. Se sincroniza con
// sessionStorage (que es la fuente de verdad usada tambien por el interceptor de api).
interface ImpersonationState {
  token: string | null;
  name: string | null;
  tenantId: string | null;
  isImpersonating: boolean;
  start: (token: string, name: string, tenantId: string) => void;
  stop: () => void;
}

export const useImpersonation = create<ImpersonationState>((set) => ({
  token: getImpersonationToken(),
  name: getImpersonationName(),
  tenantId: getImpersonationTenantId(),
  isImpersonating: !!getImpersonationToken(),

  start: (token, name, tenantId) => {
    setImpersonation(token, name, tenantId);
    set({ token, name, tenantId, isImpersonating: true });
  },

  stop: () => {
    clearImpersonation();
    set({ token: null, name: null, tenantId: null, isImpersonating: false });
  },
}));
