import { Router } from 'express';
import { authRoutes } from './v1/auth.routes';
import { customerRoutes } from './v1/customer.routes';
import { serviceRoutes } from './v1/service.routes';
import { appointmentRoutes } from './v1/appointment.routes';
import { availabilityRoutes } from './v1/availability.routes';
import { dashboardRoutes } from './v1/dashboard.routes';
import { adminRoutes } from './v1/admin.routes';
import { meRoutes } from './v1/me.routes';
import { publicRoutes } from './v1/public.routes';
import { branchRoutes } from './v1/branch.routes';
import { assistantRoutes } from './v1/assistant.routes';
import { loyaltyRoutes } from './v1/loyalty.routes';
import { webhookRoutes } from './v1/webhooks.routes';

export const router = Router();

// API Versioning
router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/services', serviceRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/availability', availabilityRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/admin', adminRoutes);
router.use('/me', meRoutes);
router.use('/public', publicRoutes);
router.use('/branches', branchRoutes);
router.use('/assistants', assistantRoutes);
router.use('/loyalty', loyaltyRoutes);

// Webhooks PUBLICOS de proveedores externos (sin auth). Montados fuera de los
// grupos autenticados: Mercado Pago los invoca directamente.
router.use('/webhooks', webhookRoutes);

// Health check
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: 'v1' });
});
