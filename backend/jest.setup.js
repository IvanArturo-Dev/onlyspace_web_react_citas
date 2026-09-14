// Configuracion global para las pruebas (Jest). Se ejecuta antes de cada suite
// via `setupFiles` en jest.config.js. Fija variables de entorno minimas que los
// servicios necesitan para no depender del entorno del runner (ej. JWT_SECRET),
// sin sobrescribir las que ya vengan definidas (CI las inyecta).
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "15m";
process.env.REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || "7d";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
