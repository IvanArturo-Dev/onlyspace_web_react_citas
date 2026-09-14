import axios from "axios";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000/v1";

export const TOKEN_KEY = "auth_token";
export const REFRESH_KEY = "refresh_token";
export const USER_KEY = "user";

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { "Content-Type": "application/json" },
});

// Clave del token de impersonacion (super admin "actuando como"). Vive en sessionStorage
// aparte del token normal; cuando existe, se prefiere como Authorization.
const IMPERSONATION_TOKEN_KEY = "impersonation_token";
const IMPERSONATION_NAME_KEY = "impersonation_name";
const IMPERSONATION_TENANT_KEY = "impersonation_tenant";

api.interceptors.request.use((config) => {
  const imp = sessionStorage.getItem(IMPERSONATION_TOKEN_KEY);
  const token = imp || localStorage.getItem(TOKEN_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      // Si hay impersonacion activa y el token expira, NO intentamos refrescar con el
      // refresh del super admin (produciria un token que no es de impersonacion).
      // Lo mas seguro: limpiar la impersonacion y devolver al super admin a /admin,
      // donde retoma su sesion normal (su token sigue intacto en localStorage).
      if (sessionStorage.getItem(IMPERSONATION_TOKEN_KEY)) {
        sessionStorage.removeItem(IMPERSONATION_TOKEN_KEY);
        sessionStorage.removeItem(IMPERSONATION_NAME_KEY);
        sessionStorage.removeItem(IMPERSONATION_TENANT_KEY);
        window.location.href = "/admin";
        return Promise.reject(error);
      }

      try {
        const refreshToken = localStorage.getItem(REFRESH_KEY);
        if (refreshToken) {
          const res = await axios.post(`${API_BASE_URL}/auth/refresh`, {
            refresh_token: refreshToken,
          });
          const { access_token } = res.data;
          localStorage.setItem(TOKEN_KEY, access_token);
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        localStorage.removeItem(USER_KEY);
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

export default api;
