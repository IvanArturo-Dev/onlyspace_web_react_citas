import { Request, Response } from 'express';
import { prisma } from '../database/prisma.service';
import { publicService } from '../services/public.service';
import { availabilityService } from '../services/availability.service';
import { bookingService } from '../services/booking.service';
import { discoveryService } from '../services/discovery.service';
import {
  brandingService,
  isPremiumEffective,
} from '../services/branding.service';
import { promotionService } from '../services/promotion.service';
import { landingBannerService } from '../services/landingBanner.service';
import { waitlistService } from '../services/waitlist.service';
import { AuthRequest } from '../types/express';
import { parseOfferedModalities } from '../utils/modality';

/**
 * Envia una respuesta de error consistente con el patron del proyecto.
 * Si el error trae statusCode/code (HttpError) los usa; si no, 500 generico.
 */
function sendError(res: Response, error: any): void {
  if (error && error.statusCode) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Valida un telefono de contacto para la lista de espera: no vacio y con al
 * menos 7 digitos (ignorando separadores como espacios, guiones o parentesis).
 * No impone un formato regional estricto para no rechazar numeros validos.
 */
function isValidPhone(phone: unknown): phone is string {
  if (typeof phone !== 'string') return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7;
}

/**
 * Controladores del portal publico de reservas. Estos endpoints NO usan
 * authMiddleware: solo exponen datos NO sensibles (nombre del negocio y
 * catalogo de categorias activas / disponibilidad), resueltos por el codigo.
 */
export const publicController = {
  /**
   * GET /v1/public/:code/info
   * Resuelve la SUCURSAL por codigo y devuelve el nombre del negocio, los datos
   * de la sucursal y sus categorias (servicios) activas de esa sucursal.
   * Codigo invalido/inactivo -> 404 INVALID_CODE.
   */
  async info(req: Request, res: Response): Promise<void> {
    try {
      const branch = await publicService.resolveBranchByCode(req.params.code);

      const [tenant, services, googleAccount] = await Promise.all([
        prisma.tenant.findUnique({ where: { id: branch.tenant_id } }),
        prisma.service.findMany({
          where: { branch_id: branch.id, is_active: true },
          select: { id: true, name: true, duration_mins: true, price: true },
          orderBy: { name: 'asc' },
        }),
        prisma.googleAccount.findUnique({
          where: { tenant_id: branch.tenant_id },
        }),
      ]);

      // Premium effective = subscription active AND not expired (Req 2.3, 2.6).
      const isPremium = isPremiumEffective(tenant);

      // online_sessions_enabled: derived flag exposed to the public portal
      // (Req 1.1, 1.2, 1.4). True only when the tenant's GoogleAccount is
      // connected AND has online sessions enabled. No tokens or other
      // GoogleAccount fields are ever exposed (Req 1.3).
      const online_sessions_enabled =
        !!googleAccount &&
        googleAccount.status === 'connected' &&
        googleAccount.online_sessions === true;

      const data: {
        business: { name: string };
        branch: { id: string; name: string; maps_url: string | null };
        services: Array<{
          id: string;
          name: string;
          duration_mins: number;
          price: unknown;
        }>;
        is_premium: boolean;
        online_sessions_enabled: boolean;
        // Modalidad ofrecida por el negocio (Requirement 2.3): el portal usa
        // este valor para mostrar el selector correcto (o ninguno si es una
        // sola modalidad). Cae a 'in_person' si el tenant no se resolvio.
        offered_modality: string;
        // Modalidad ofrecida como lista (Requirement 1.3): array de strings
        // parseado del CSV `offered_modalities`. El portal muestra el selector
        // segun estas modalidades (o lo oculta si es una sola).
        offered_modalities: string[];
        // Bandera de contacto (Requirement 6.1-6.3): siempre presente. Los datos
        // de contacto (`contact`) SOLO se incluyen cuando show_contact es true.
        show_contact: boolean;
        // Recargo a domicilio del negocio (Requirement 1.3): number (0 = sin
        // costo adicional). Relevante cuando el negocio ofrece 'home'; se expone
        // siempre como number para que el portal lo muestre.
        home_service_fee: number;
        contact?: {
          whatsapp_number: string | null;
        };
        branding?: {
          logo_url: string | null;
          brand_color: string | null;
          banner_title: string | null;
          banner_text: string | null;
          banner_link: string | null;
        };
        ads?: Array<{
          id: string;
          title: string;
          body: string | null;
          image_url: string | null;
          link_url: string | null;
        }>;
        promotions?: Array<{
          id: string;
          title: string;
          description: string | null;
          image_url: string | null;
          starts_at: Date | string | null;
          ends_at: Date | string | null;
        }>;
      } = {
        business: { name: tenant?.name ?? '' },
        // maps_url de la sucursal resuelta (Requirement 7.2): el portal muestra
        // el boton "Como llegar" cuando existe. null cuando no hay dato.
        branch: {
          id: branch.id,
          name: branch.name,
          maps_url: branch.maps_url ?? null,
        },
        services: services.map((s) => ({
          id: s.id,
          name: s.name,
          duration_mins: s.duration_mins,
          price: s.price,
        })),
        is_premium: isPremium,
        online_sessions_enabled,
        // Modalidad ofrecida (Requirement 2.3): expuesta a todos los negocios
        // (no gateada por premium). Default 'in_person' si no hay tenant.
        offered_modality: tenant?.offered_modality ?? 'in_person',
        // Lista de modalidades ofrecidas (Requirement 1.3): array parseado del
        // CSV. Default ['in_person'] si el tenant no se resolvio.
        offered_modalities: parseOfferedModalities(tenant?.offered_modalities),
        // Bandera de contacto (Requirement 6.1-6.3): la bandera se expone
        // siempre; los datos de contacto se añaden solo si esta activada.
        show_contact: tenant?.show_contact === true,
        // Recargo a domicilio (Requirement 1.3): number, 0 si no hay tenant o
        // no tiene recargo configurado. Prisma Decimal -> Number.
        home_service_fee: tenant ? Number(tenant.home_service_fee) : 0,
      };

      // Datos de contacto (Requirement 6.2): SOLO cuando show_contact esta ON se
      // exponen los datos disponibles (WhatsApp/telefono del negocio). Cuando
      // esta OFF el portal no expone nada (Requirement 6.3).
      if (tenant?.show_contact === true) {
        data.contact = {
          whatsapp_number: tenant.whatsapp_number ?? null,
        };
      }

      // Branding + own ads are exposed ONLY for premium-effective tenants
      // (Requirement 3.3, 3.4, 5.1, 5.3 — Property 2). Non-premium omits them.
      if (isPremium && tenant) {
        data.branding = {
          logo_url: tenant.logo_url ?? null,
          brand_color: tenant.brand_color ?? null,
          banner_title: tenant.banner_title ?? null,
          banner_text: tenant.banner_text ?? null,
          banner_link: tenant.banner_link ?? null,
        };
        data.ads = await brandingService.listActiveAdsPublic(tenant.id);

        // Promociones vigentes de la sucursal, solo campos PUBLICOS (nunca
        // is_active/tenant/created): titulo, descripcion, imagen y vigencia
        // (Requirements 3.1, 3.3). Negocios free quedan fuera de este bloque
        // y no exponen promociones (Property 5).
        const promotions = await promotionService.listActivePublic(branch.id);
        data.promotions = promotions.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          image_url: p.image_url,
          starts_at: p.starts_at,
          ends_at: p.ends_at,
        }));
      }

      res.status(200).json({ success: true, data });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * GET /v1/public/search?q=
   * Busqueda basica de sucursales activas por nombre de sucursal o de negocio.
   * Devuelve solo datos no sensibles ({ code, branch_name, business_name }).
   * q vacio/corto -> [] (no lista todo el catalogo).
   */
  async search(req: Request, res: Response): Promise<void> {
    try {
      const q = (req.query.q as string | undefined) ?? '';
      const results = await publicService.searchBranches(q);

      res.status(200).json({
        success: true,
        data: { results },
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * GET /v1/public/discover?q=&category=&lat=&lng=&radius_km=
   * Landing publico de descubrimiento: lista negocios reservables via su
   * sucursal principal, con priorizacion premium, filtros por texto/categoria
   * y orden opcional por cercania. Solo datos NO sensibles (Req 1.1, 1.2, 1.3).
   * Los parametros numericos no validos se tratan como ausentes en el service.
   */
  async discover(req: Request, res: Response): Promise<void> {
    try {
      const q = req.query.q as string | undefined;
      const category = req.query.category as string | undefined;
      // lat/lng/radius_km opcionales: solo se convierten cuando vienen. Si el
      // string no es numerico, Number(...) da NaN y el service lo ignora.
      const lat = req.query.lat !== undefined ? Number(req.query.lat) : undefined;
      const lng = req.query.lng !== undefined ? Number(req.query.lng) : undefined;
      const radius_km =
        req.query.radius_km !== undefined ? Number(req.query.radius_km) : undefined;

      const items = await discoveryService.discover({
        q,
        category,
        lat,
        lng,
        radius_km,
      });

      res.status(200).json({ success: true, data: { items } });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * GET /v1/public/categories
   * Devuelve los nombres distintos de categorias activas de negocios
   * reservables, para alimentar los chips del landing (Req 3.4).
   */
  async categories(_req: Request, res: Response): Promise<void> {
    try {
      const items = await discoveryService.categories();

      res.status(200).json({ success: true, data: { categories: items } });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * GET /v1/public/landing-banners
   * Devuelve los banners ACTIVOS del carrusel del landing, ordenados por
   * sort_order. Solo datos publicos (sin timestamps ni is_active).
   */
  async landingBanners(_req: Request, res: Response): Promise<void> {
    try {
      const banners = await landingBannerService.listActivePublic();
      res.status(200).json({ success: true, data: { banners } });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * GET /v1/public/:code/availability?service_id=&date=
   * Resuelve el tenant y devuelve los slots libres para el servicio y fecha.
   * Faltan service_id o date, o date con formato invalido -> 400.
   * Codigo invalido -> 404 INVALID_CODE.
   */
  async availability(req: Request, res: Response): Promise<void> {
    try {
      const serviceId = req.query.service_id as string | undefined;
      const date = req.query.date as string | undefined;

      if (!serviceId || !date) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PARAMS',
            message: 'service_id y date son requeridos',
          },
        });
        return;
      }

      if (!DATE_PATTERN.test(date)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATE',
            message: 'date debe tener formato YYYY-MM-DD',
          },
        });
        return;
      }

      const branch = await publicService.resolveBranchByCode(req.params.code);

      const slots = await availabilityService.getBranchAvailability(
        branch.id,
        serviceId,
        date
      );

      res.status(200).json({
        success: true,
        data: { date, service_id: serviceId, slots },
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * POST /v1/public/:code/appointments
   * Requiere authMiddleware (cualquier usuario autenticado: CLIENT o ADMIN).
   * Crea una reserva en el negocio identificado por el codigo.
   * Faltan service_id o start_time -> 400. Slot ocupado -> 409 SLOT_TAKEN.
   */
  async createBooking(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { service_id, start_time, modality, contact_phone, home_address, maps_url } =
        req.body ?? {};

      if (!service_id || !start_time) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PARAMS',
            message: 'service_id y start_time son requeridos',
          },
        });
        return;
      }

      // Identidad del usuario autenticado: email/name no viajan en el JWT,
      // se consultan del User por su id.
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true, name: true },
      });

      const branch = await publicService.resolveBranchByCode(req.params.code);

      // modality se pasa crudo: el service lo normaliza (incluye 'home'). El
      // service tambien valida telefono/domicilio (contact_phone siempre; y
      // home_address + maps_url cuando la modalidad es 'home').
      const booking = await bookingService.createBranchBooking(
        branch.id,
        { service_id, start_time, modality, contact_phone, home_address, maps_url },
        { id: req.user!.id, email: dbUser?.email, name: dbUser?.name }
      );

      res.status(201).json({
        success: true,
        data: booking,
        message: 'Cita agendada',
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },

  /**
   * POST /v1/public/:code/waitlist
   * Requiere authMiddleware (cualquier usuario autenticado: CLIENT o ADMIN).
   * Anota al cliente autenticado en la lista de espera de un servicio para una
   * fecha, capturando un telefono de contacto para avisarle si se libera un
   * espacio. Es el equivalente PUBLICO de la cola de espera del staff.
   *
   * Body: { service_id, date (YYYY-MM-DD), phone (obligatorio), desired_start? }.
   * Faltan service_id/date/phone -> 400 MISSING_PARAMS.
   * phone invalido (sin digitos suficientes) -> 400 INVALID_PHONE.
   * date con formato invalido -> 400 INVALID_DATE.
   * Codigo invalido -> 404 INVALID_CODE. Cliente con deuda -> 409 CUSTOMER_HAS_DEBT.
   */
  async joinWaitlist(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { service_id, date, phone, desired_start } = req.body ?? {};

      if (!service_id || !date || !phone) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_PARAMS',
            message: 'service_id, date y phone son requeridos',
          },
        });
        return;
      }

      if (!isValidPhone(phone)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_PHONE',
            message: 'El telefono no es valido',
          },
        });
        return;
      }

      if (!DATE_PATTERN.test(date)) {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_DATE',
            message: 'date debe tener formato YYYY-MM-DD',
          },
        });
        return;
      }

      // Identidad del usuario autenticado (email/name no viajan en el JWT).
      const dbUser = await prisma.user.findUnique({
        where: { id: req.user!.id },
        select: { email: true, name: true },
      });

      const branch = await publicService.resolveBranchByCode(req.params.code);

      // Resolucion del customer del tenant, mismo patron que createBranchBooking:
      // se asocia por email dentro del tenant y, si no existe, se crea. A
      // diferencia de la reserva, aqui el cliente provee un telefono real de
      // contacto, que se guarda al crear y se refresca si el customer existente
      // aun tenia el placeholder 'sin-telefono'.
      const trimmedPhone = phone.trim();
      let customer = null;
      if (dbUser?.email) {
        customer = await prisma.customer.findFirst({
          where: { tenant_id: branch.tenant_id, email: dbUser.email },
        });
      }

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            tenant_id: branch.tenant_id,
            name: dbUser?.name || dbUser?.email || 'Cliente',
            email: dbUser?.email ?? null,
            phone: trimmedPhone,
          },
        });
      } else if (!customer.phone || customer.phone === 'sin-telefono') {
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: { phone: trimmedPhone },
        });
      }

      const entry = await waitlistService.join({
        tenantId: branch.tenant_id,
        branchId: branch.id,
        serviceId: service_id,
        customerId: customer.id,
        desiredDate: new Date(`${date}T00:00:00.000Z`),
        desiredStart: desired_start ? new Date(desired_start) : null,
      });

      res.status(201).json({
        success: true,
        data: entry,
        message: 'Te anotamos en la lista de espera',
      });
    } catch (error: any) {
      sendError(res, error);
    }
  },
};
