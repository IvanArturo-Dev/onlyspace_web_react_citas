import { Router } from 'express';
import { publicController } from '../../controllers/public.controller';
import { authMiddleware } from '../../middleware/auth';

/**
 * Rutas publicas del portal de reservas. NO usan authMiddleware: solo exponen
 * datos no sensibles (nombre del negocio, categorias activas y disponibilidad).
 * El rate limiter global (`defaultRateLimit` en app.ts) ya aplica aqui.
 */
export const publicRoutes = Router();

// GET /v1/public/search?q=
// IMPORTANTE: se declara ANTES de las rutas /:code/... para que "search" no
// sea capturado como un codigo de sucursal.
publicRoutes.get('/search', publicController.search);

// GET /v1/public/discover?q=&category=&lat=&lng=&radius_km=
// GET /v1/public/categories
// IMPORTANTE: ambas se declaran ANTES de las rutas /:code/... para que
// "discover" y "categories" no sean capturados como codigo de sucursal.
publicRoutes.get('/discover', publicController.discover);
publicRoutes.get('/categories', publicController.categories);

// GET /v1/public/landing-banners
// IMPORTANTE: se declara ANTES de las rutas /:code/... para que
// "landing-banners" no sea capturado como codigo de sucursal.
publicRoutes.get('/landing-banners', publicController.landingBanners);

// GET /v1/public/:code/info
publicRoutes.get('/:code/info', publicController.info);

// GET /v1/public/:code/availability?service_id=&date=
publicRoutes.get('/:code/availability', publicController.availability);

// POST /v1/public/:code/appointments
// A diferencia de info/availability, este SI requiere authMiddleware:
// cualquier usuario autenticado (CLIENT o ADMIN) puede crear la reserva.
publicRoutes.post('/:code/appointments', authMiddleware, publicController.createBooking);
