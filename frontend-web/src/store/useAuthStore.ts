import { create } from "zustand";
import type { User } from "../types";
import { authService } from "../services/auth.service";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  init: () => void;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  init: () => {
    const user = authService.getCurrentUser();
    set({ user, isAuthenticated: !!user, isLoading: false });
  },

  loginWithGoogle: async () => {
    const user = await authService.loginWithGoogle();
    set({ user, isAuthenticated: true });
  },

  logout: async () => {
    await authService.logout();
    set({ user: null, isAuthenticated: false });
  },
}));
