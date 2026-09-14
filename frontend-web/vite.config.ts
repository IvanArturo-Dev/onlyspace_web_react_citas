import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // host:true expone el dev server en la LAN (para probar desde otro dispositivo).
    // El HMR usa por defecto el mismo host del navegador, asi que funciona igual en
    // localhost y por IP local, sin forzar el dominio del tunel.
    host: true,
    // Permite servir el frontend por el dominio del tunel cuando este activo.
    allowedHosts: ["app.onlyspace.site", ".onlyspace.site", "localhost"],
  },
});
