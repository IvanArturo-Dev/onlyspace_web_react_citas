import api, { TOKEN_KEY, REFRESH_KEY, USER_KEY } from "./api";
import type { User } from "../types";
import { getFirebaseAuth } from "../lib/firebase";
import { GoogleAuthProvider, signInWithPopup } from "firebase/auth";

function persistSession(access_token: string, refresh_token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, access_token);
  if (refresh_token) localStorage.setItem(REFRESH_KEY, refresh_token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export const authService = {
  async loginWithGoogle(): Promise<User> {
    const auth = getFirebaseAuth();
    if (!auth) {
      throw new Error("Firebase no esta configurado. Agrega la config web en .env");
    }
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken();

    // El backend verifica el ID token de Firebase y establece la sesion.
    const res = await api.post("/auth/firebase/login", { id_token: idToken });
    const { access_token, refresh_token, user } = res.data;
    persistSession(access_token, refresh_token, user);
    return user;
  },

  async logout(): Promise<void> {
    try {
      await api.post("/auth/logout");
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },

  getCurrentUser(): User | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  },
};
