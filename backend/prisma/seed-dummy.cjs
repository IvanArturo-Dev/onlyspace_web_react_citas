/**
 * SEED de datos DUMMY para probar el PORTAL PÚBLICO.
 *
 * - IDEMPOTENTE: upsert por claves únicas. Se puede correr N veces sin duplicar.
 * - NO borra ni modifica datos existentes. NO toca el tenant real "develop.arturo".
 * - Standalone CommonJS. Ejecutar con: node prisma/seed-dummy.cjs
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Tenant real que NUNCA debemos tocar.
const PROTECTED_TENANT_ID = "cmti4ze39000013plddcrah9m";

// Alfabeto sin caracteres ambiguos (sin I, O, 0, 1, etc.).
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomCode(len = 6) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/**
 * Genera un booking_code de 6 chars único contra Tenant.booking_code y
 * Branch.booking_code. Usado solo como fallback; en este seed usamos códigos
 * fijos y legibles, pero mantenemos la verificación de colisión.
 */
async function generateUniqueBookingCode() {
  // Intentos acotados; el espacio es enorme (32^6) así que basta con pocos.
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomCode(6);
    const [t, b] = await Promise.all([
      prisma.tenant.findUnique({ where: { booking_code: code } }),
      prisma.branch.findUnique({ where: { booking_code: code } }),
    ]);
    if (!t && !b) return code;
  }
  throw new Error("No se pudo generar un booking_code único tras varios intentos");
}

/**
 * Devuelve un booking_code utilizable:
 * - Si `preferred` está libre (o ya pertenece al propietario esperado), lo usa.
 * - Si está ocupado por otra entidad, genera uno único aleatorio.
 *
 * @param {string} preferred código fijo deseado
 * @param {{tenantIdOwner?: string, branchIdOwner?: string}} owner identidad esperada del dueño
 */
async function resolveBookingCode(preferred, owner = {}) {
  const [t, b] = await Promise.all([
    prisma.tenant.findUnique({ where: { booking_code: preferred } }),
    prisma.branch.findUnique({ where: { booking_code: preferred } }),
  ]);

  const ownedByExpectedTenant = t && owner.tenantIdOwner && t.id === owner.tenantIdOwner;
  const ownedByExpectedBranch = b && owner.branchIdOwner && b.id === owner.branchIdOwner;

  // Libre en ambas tablas -> lo usamos.
  if (!t && !b) return preferred;
  // Ya pertenece a quien esperamos -> lo reutilizamos.
  if ((t && ownedByExpectedTenant && !b) || (b && ownedByExpectedBranch && !t)) {
    return preferred;
  }
  // Ocupado por otro -> generamos uno aleatorio único.
  return generateUniqueBookingCode();
}

function inOneYear() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d;
}

/** Fecha futura a partir de hoy con hora fija. */
function futureAt(daysAhead, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Fecha pasada. */
function pastAt(daysBack, hour, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60_000);
}

// ---------------------------------------------------------------------------
// Upsert helpers idempotentes
// ---------------------------------------------------------------------------

async function upsertTenant(data) {
  const existing = await prisma.tenant.findUnique({ where: { subdomain: data.subdomain } });

  if (existing && existing.id === PROTECTED_TENANT_ID) {
    throw new Error(`ABORTADO: el subdomain '${data.subdomain}' apunta al tenant protegido.`);
  }

  // Reutilizar booking_code existente si el tenant ya existe.
  const bookingCode = existing
    ? existing.booking_code
    : await resolveBookingCode(data.bookingCode);

  const payload = {
    name: data.name,
    booking_code: bookingCode,
    booking_enabled: true,
    subscription_status: data.subscriptionStatus,
    subscription_expires_at: data.subscriptionExpiresAt ?? null,
    logo_url: data.logoUrl ?? null,
    brand_color: data.brandColor ?? null,
    banner_title: data.bannerTitle ?? null,
    banner_text: data.bannerText ?? null,
    banner_link: data.bannerLink ?? null,
    whatsapp_number: data.whatsappNumber ?? null,
    whatsapp_template: data.whatsappTemplate ?? null,
    status: "active",
  };

  return prisma.tenant.upsert({
    where: { subdomain: data.subdomain },
    update: payload,
    create: { subdomain: data.subdomain, ...payload },
  });
}

async function upsertBranch(tenantId, name, preferredCode) {
  const existing = await prisma.branch.findFirst({ where: { tenant_id: tenantId, name } });
  if (existing) {
    // Mantener el booking_code existente (no regenerar).
    return prisma.branch.update({
      where: { id: existing.id },
      data: { status: "active", timezone: "America/Mexico_City" },
    });
  }
  const code = await resolveBookingCode(preferredCode);
  return prisma.branch.create({
    data: {
      tenant_id: tenantId,
      name,
      status: "active",
      booking_code: code,
      timezone: "America/Mexico_City",
    },
  });
}

async function upsertAd(tenantId, { title, body, imageUrl, linkUrl, isActive }) {
  const existing = await prisma.advertisement.findFirst({
    where: { tenant_id: tenantId, title },
  });
  const payload = {
    body: body ?? null,
    image_url: imageUrl ?? null,
    link_url: linkUrl ?? null,
    is_active: isActive,
  };
  if (existing) {
    return prisma.advertisement.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.advertisement.create({ data: { tenant_id: tenantId, title, ...payload } });
}

async function upsertCategory(tenantId, name, description) {
  const existing = await prisma.category.findFirst({ where: { tenant_id: tenantId, name } });
  if (existing) {
    return prisma.category.update({
      where: { id: existing.id },
      data: { description: description ?? null, is_active: true },
    });
  }
  return prisma.category.create({
    data: { tenant_id: tenantId, name, description: description ?? null, is_active: true },
  });
}

async function upsertService(tenantId, branchId, categoryId, s) {
  const existing = await prisma.service.findFirst({ where: { tenant_id: tenantId, name: s.name } });
  const payload = {
    branch_id: branchId ?? null,
    description: s.description ?? null,
    duration_mins: s.duration,
    price: s.price,
    category_id: categoryId ?? null,
    color: s.color ?? "#3B82F6",
    is_active: true,
    capacity: s.capacity ?? 1,
  };
  if (existing) {
    return prisma.service.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.service.create({ data: { tenant_id: tenantId, name: s.name, ...payload } });
}

async function upsertSchedule(tenantId, branchId, name, days) {
  let schedule = await prisma.schedule.findFirst({ where: { tenant_id: tenantId, name } });
  if (!schedule) {
    schedule = await prisma.schedule.create({
      data: {
        tenant_id: tenantId,
        branch_id: branchId ?? null,
        name,
        timezone: "America/Mexico_City",
        is_active: true,
      },
    });
  } else {
    schedule = await prisma.schedule.update({
      where: { id: schedule.id },
      data: { branch_id: branchId ?? null, timezone: "America/Mexico_City", is_active: true },
    });
  }

  // Upsert de cada día por @@unique([schedule_id, day_of_week]).
  for (const d of days) {
    await prisma.scheduleDay.upsert({
      where: { schedule_id_day_of_week: { schedule_id: schedule.id, day_of_week: d.dow } },
      update: { open_time: d.open, close_time: d.close, is_active: true },
      create: {
        schedule_id: schedule.id,
        day_of_week: d.dow,
        open_time: d.open,
        close_time: d.close,
        is_active: true,
      },
    });
  }
  return schedule;
}

async function upsertCustomer(tenantId, name, phone, email) {
  // Customer.email no es único; usamos (tenant_id, name, phone) como clave lógica.
  const existing = await prisma.customer.findFirst({
    where: { tenant_id: tenantId, name, phone },
  });
  const payload = { email: email ?? null, status: "active" };
  if (existing) {
    return prisma.customer.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.customer.create({
    data: { tenant_id: tenantId, name, phone, ...payload },
  });
}

async function upsertAppointment(tenantId, branchId, appt) {
  // Clave lógica: (tenant_id, customer_id, service_id, start_time).
  const existing = await prisma.appointment.findFirst({
    where: {
      tenant_id: tenantId,
      customer_id: appt.customerId,
      service_id: appt.serviceId,
      start_time: appt.startTime,
    },
  });
  const payload = {
    branch_id: branchId ?? null,
    end_time: appt.endTime,
    status: appt.status,
    modality: appt.modality ?? "in_person",
    payment_status: appt.paymentStatus,
    amount_total: appt.amountTotal,
    amount_paid: appt.amountPaid,
    currency: "MXN",
  };
  if (existing) {
    return prisma.appointment.update({ where: { id: existing.id }, data: payload });
  }
  return prisma.appointment.create({
    data: {
      tenant_id: tenantId,
      customer_id: appt.customerId,
      service_id: appt.serviceId,
      start_time: appt.startTime,
      ...payload,
    },
  });
}

// ---------------------------------------------------------------------------
// Definición de los negocios dummy
// ---------------------------------------------------------------------------

async function seedBarberia() {
  const tenant = await upsertTenant({
    name: "Barbería El Clásico",
    subdomain: "barberia-el-clasico",
    bookingCode: "BARBER",
    subscriptionStatus: "active",
    subscriptionExpiresAt: inOneYear(),
    brandColor: "#1F2937",
    logoUrl: "https://picsum.photos/seed/barber/200",
    bannerTitle: "Cortes con estilo",
    bannerText: "Reserva tu corte hoy y luce increíble",
    bannerLink: "https://ejemplo.com",
    whatsappNumber: "5215500000001",
    whatsappTemplate: "Hola, quiero agendar una cita en Barbería El Clásico",
  });

  const centro = await upsertBranch(tenant.id, "Centro", "BARBC1");
  const norte = await upsertBranch(tenant.id, "Norte", "BARBN2");

  await upsertAd(tenant.id, {
    title: "Promo 2x1 en cortes",
    body: "Trae a un amigo",
    imageUrl: "https://picsum.photos/seed/ad1/400/200",
    linkUrl: "https://ejemplo.com/promo",
    isActive: true,
  });
  await upsertAd(tenant.id, {
    title: "Anuncio inactivo de prueba",
    body: "Este no debe mostrarse en el portal",
    imageUrl: "https://picsum.photos/seed/ad1b/400/200",
    linkUrl: "https://ejemplo.com/inactivo",
    isActive: false,
  });

  const catCortes = await upsertCategory(tenant.id, "Cortes", "Cortes de cabello");
  const catBarba = await upsertCategory(tenant.id, "Barba", "Servicios de barba");

  const svCorteClasico = await upsertService(tenant.id, centro.id, catCortes.id, {
    name: "Corte clásico",
    description: "Corte de cabello tradicional",
    duration: 30,
    price: 150,
    color: "#1F2937",
  });
  const svCorteBarba = await upsertService(tenant.id, centro.id, catCortes.id, {
    name: "Corte + barba",
    description: "Corte de cabello más arreglo de barba",
    duration: 45,
    price: 250,
    color: "#374151",
  });
  await upsertService(tenant.id, centro.id, catBarba.id, {
    name: "Afeitado tradicional",
    description: "Afeitado con navaja y toalla caliente",
    duration: 30,
    price: 180,
    color: "#4B5563",
  });
  await upsertService(tenant.id, centro.id, catBarba.id, {
    name: "Diseño de barba",
    description: "Perfilado y diseño de barba",
    duration: 20,
    price: 120,
    color: "#6B7280",
  });

  await upsertSchedule(tenant.id, centro.id, "Horario Centro", [
    { dow: 1, open: "09:00", close: "19:00" },
    { dow: 2, open: "09:00", close: "19:00" },
    { dow: 3, open: "09:00", close: "19:00" },
    { dow: 4, open: "09:00", close: "19:00" },
    { dow: 5, open: "09:00", close: "19:00" },
    { dow: 6, open: "10:00", close: "15:00" },
    // domingo (0) cerrado -> no se crea
  ]);

  const laura = await upsertCustomer(tenant.id, "Laura Gómez", "5511111111", "laura.gomez@ejemplo.com");
  const pedro = await upsertCustomer(tenant.id, "Pedro Ruiz", "5522222222", "pedro.ruiz@ejemplo.com");
  const ana = await upsertCustomer(tenant.id, "Ana Torres", "5533333333", "ana.torres@ejemplo.com");

  // Cita 1: CONFIRMED futura, paid.
  const c1Start = futureAt(2, 11, 0);
  await upsertAppointment(tenant.id, centro.id, {
    customerId: laura.id,
    serviceId: svCorteClasico.id,
    startTime: c1Start,
    endTime: addMinutes(c1Start, 30),
    status: "CONFIRMED",
    paymentStatus: "paid",
    amountTotal: 150,
    amountPaid: 150,
  });
  // Cita 2: PENDING futura, partial.
  const c2Start = futureAt(3, 12, 0);
  await upsertAppointment(tenant.id, centro.id, {
    customerId: pedro.id,
    serviceId: svCorteBarba.id,
    startTime: c2Start,
    endTime: addMinutes(c2Start, 45),
    status: "PENDING",
    paymentStatus: "partial",
    amountTotal: 250,
    amountPaid: 100,
  });
  // Cita 3: COMPLETED pasada, unpaid.
  const c3Start = pastAt(4, 10, 0);
  await upsertAppointment(tenant.id, centro.id, {
    customerId: ana.id,
    serviceId: svCorteClasico.id,
    startTime: c3Start,
    endTime: addMinutes(c3Start, 30),
    status: "COMPLETED",
    paymentStatus: "unpaid",
    amountTotal: 150,
    amountPaid: 0,
  });

  return {
    label: "Barbería El Clásico",
    plan: "PREMIUM",
    tenantCode: tenant.booking_code,
    branches: [
      { name: "Centro", code: centro.booking_code },
      { name: "Norte", code: norte.booking_code },
    ],
  };
}

async function seedSpa() {
  const tenant = await upsertTenant({
    name: "Spa Serenity",
    subdomain: "spa-serenity",
    bookingCode: "SERENI",
    subscriptionStatus: "active",
    subscriptionExpiresAt: inOneYear(),
    brandColor: "#0EA5E9",
    logoUrl: "https://picsum.photos/seed/spa/200",
    bannerTitle: "Relájate y renueva",
    bannerText: "Vive una experiencia de bienestar total",
    bannerLink: "https://ejemplo.com/spa",
    whatsappNumber: "5215500000002",
    whatsappTemplate: "Hola, quiero agendar en Spa Serenity",
  });

  const principal = await upsertBranch(tenant.id, "Principal", "SPAP01");

  await upsertAd(tenant.id, {
    title: "Masaje relajante -20%",
    body: "Promoción por tiempo limitado",
    imageUrl: "https://picsum.photos/seed/spaad/400/200",
    linkUrl: "https://ejemplo.com/spa/promo",
    isActive: true,
  });

  const catMasajes = await upsertCategory(tenant.id, "Masajes", "Terapias de masaje");
  const catFaciales = await upsertCategory(tenant.id, "Faciales", "Tratamientos faciales");

  const svRelajante = await upsertService(tenant.id, principal.id, catMasajes.id, {
    name: "Masaje relajante",
    description: "Masaje corporal relajante",
    duration: 60,
    price: 600,
    color: "#0EA5E9",
  });
  const svFacial = await upsertService(tenant.id, principal.id, catFaciales.id, {
    name: "Facial hidratante",
    description: "Limpieza e hidratación facial",
    duration: 45,
    price: 450,
    color: "#38BDF8",
  });
  await upsertService(tenant.id, principal.id, catMasajes.id, {
    name: "Masaje deportivo",
    description: "Masaje de recuperación muscular",
    duration: 60,
    price: 700,
    color: "#0284C7",
  });

  // mar-dom 10:00-20:00 (2..6 y 0), lunes cerrado.
  await upsertSchedule(tenant.id, principal.id, "Horario Principal", [
    { dow: 2, open: "10:00", close: "20:00" },
    { dow: 3, open: "10:00", close: "20:00" },
    { dow: 4, open: "10:00", close: "20:00" },
    { dow: 5, open: "10:00", close: "20:00" },
    { dow: 6, open: "10:00", close: "20:00" },
    { dow: 0, open: "10:00", close: "20:00" },
  ]);

  const sofia = await upsertCustomer(tenant.id, "Sofía Méndez", "5544444444", "sofia.mendez@ejemplo.com");
  const carlos = await upsertCustomer(tenant.id, "Carlos Vega", "5555555555", "carlos.vega@ejemplo.com");

  const s1 = futureAt(2, 11, 0);
  await upsertAppointment(tenant.id, principal.id, {
    customerId: sofia.id,
    serviceId: svRelajante.id,
    startTime: s1,
    endTime: addMinutes(s1, 60),
    status: "CONFIRMED",
    paymentStatus: "paid",
    amountTotal: 600,
    amountPaid: 600,
  });
  const s2 = pastAt(3, 16, 0);
  await upsertAppointment(tenant.id, principal.id, {
    customerId: carlos.id,
    serviceId: svFacial.id,
    startTime: s2,
    endTime: addMinutes(s2, 45),
    status: "COMPLETED",
    paymentStatus: "paid",
    amountTotal: 450,
    amountPaid: 450,
  });

  return {
    label: "Spa Serenity",
    plan: "PREMIUM",
    tenantCode: tenant.booking_code,
    branches: [{ name: "Principal", code: principal.booking_code }],
  };
}

async function seedNails() {
  const tenant = await upsertTenant({
    name: "Estudio Nails",
    subdomain: "estudio-nails",
    bookingCode: "NAILSX",
    subscriptionStatus: "inactive", // FREE / sin suscripción activa
    subscriptionExpiresAt: null,
    brandColor: "#EC4899",
    logoUrl: "https://picsum.photos/seed/nails/200",
    bannerTitle: "Uñas de ensueño",
    bannerText: "Diseños únicos para ti",
    bannerLink: "https://ejemplo.com/nails",
    whatsappNumber: "5215500000003",
    whatsappTemplate: "Hola, quiero agendar en Estudio Nails",
  });

  // "Principal" es la más antigua -> se crea primero.
  const principal = await upsertBranch(tenant.id, "Principal", "NAILP1");
  const roma = await upsertBranch(tenant.id, "Sucursal Roma", "NAILR2");

  await upsertAd(tenant.id, {
    title: "Descuento en uñas acrílicas",
    body: "Aprovecha esta semana",
    imageUrl: "https://picsum.photos/seed/nailsad/400/200",
    linkUrl: "https://ejemplo.com/nails/promo",
    isActive: true,
  });

  const catManos = await upsertCategory(tenant.id, "Manos", "Servicios de manos");
  const catPies = await upsertCategory(tenant.id, "Pies", "Servicios de pies");

  const svManicure = await upsertService(tenant.id, principal.id, catManos.id, {
    name: "Manicure",
    description: "Manicure completo",
    duration: 45,
    price: 250,
    color: "#EC4899",
  });
  await upsertService(tenant.id, principal.id, catPies.id, {
    name: "Pedicure",
    description: "Pedicure completo",
    duration: 60,
    price: 300,
    color: "#DB2777",
  });
  await upsertService(tenant.id, principal.id, catManos.id, {
    name: "Uñas acrílicas",
    description: "Aplicación de uñas acrílicas",
    duration: 90,
    price: 500,
    color: "#BE185D",
  });

  // lun-sáb 11:00-19:00 (1..6).
  await upsertSchedule(tenant.id, principal.id, "Horario Principal", [
    { dow: 1, open: "11:00", close: "19:00" },
    { dow: 2, open: "11:00", close: "19:00" },
    { dow: 3, open: "11:00", close: "19:00" },
    { dow: 4, open: "11:00", close: "19:00" },
    { dow: 5, open: "11:00", close: "19:00" },
    { dow: 6, open: "11:00", close: "19:00" },
  ]);

  const maria = await upsertCustomer(tenant.id, "María López", "5566666666", "maria.lopez@ejemplo.com");
  const daniela = await upsertCustomer(tenant.id, "Daniela Cruz", "5577777777", "daniela.cruz@ejemplo.com");

  const n1 = futureAt(2, 12, 0);
  await upsertAppointment(tenant.id, principal.id, {
    customerId: maria.id,
    serviceId: svManicure.id,
    startTime: n1,
    endTime: addMinutes(n1, 45),
    status: "CONFIRMED",
    paymentStatus: "paid",
    amountTotal: 250,
    amountPaid: 250,
  });

  return {
    label: "Estudio Nails",
    plan: "FREE",
    tenantCode: tenant.booking_code,
    branches: [
      { name: "Principal", code: principal.booking_code },
      { name: "Sucursal Roma", code: roma.booking_code },
    ],
    extra: { danielaId: daniela.id },
  };
}

async function seedDental() {
  const tenant = await upsertTenant({
    name: "Consultorio Dental Sonríe",
    subdomain: "dental-sonrie",
    bookingCode: "DENTAL",
    subscriptionStatus: "active",
    subscriptionExpiresAt: inOneYear(),
    brandColor: "#10B981",
    logoUrl: "https://picsum.photos/seed/dental/200",
    bannerTitle: "Tu sonrisa en buenas manos",
    bannerText: "Atención dental profesional y cálida",
    bannerLink: "https://ejemplo.com/dental",
    whatsappNumber: "5215500000004",
    whatsappTemplate: "Hola, quiero agendar en Consultorio Dental Sonríe",
  });

  const principal = await upsertBranch(tenant.id, "Principal", "DENTP1");

  await upsertAd(tenant.id, {
    title: "Limpieza dental gratis en tu primera cita",
    body: "Válido para nuevos pacientes",
    imageUrl: "https://picsum.photos/seed/dentalad/400/200",
    linkUrl: "https://ejemplo.com/dental/promo",
    isActive: true,
  });

  const catGeneral = await upsertCategory(tenant.id, "General", "Odontología general");
  const catEstetica = await upsertCategory(tenant.id, "Estética", "Odontología estética");

  const svLimpieza = await upsertService(tenant.id, principal.id, catGeneral.id, {
    name: "Limpieza dental",
    description: "Limpieza y profilaxis dental",
    duration: 40,
    price: 500,
    color: "#10B981",
  });
  const svExtraccion = await upsertService(tenant.id, principal.id, catGeneral.id, {
    name: "Extracción",
    description: "Extracción dental",
    duration: 60,
    price: 900,
    color: "#059669",
  });
  await upsertService(tenant.id, principal.id, catEstetica.id, {
    name: "Blanqueamiento",
    description: "Blanqueamiento dental",
    duration: 60,
    price: 2500,
    color: "#34D399",
  });

  // lun-vie 08:00-16:00 (1..5).
  await upsertSchedule(tenant.id, principal.id, "Horario Principal", [
    { dow: 1, open: "08:00", close: "16:00" },
    { dow: 2, open: "08:00", close: "16:00" },
    { dow: 3, open: "08:00", close: "16:00" },
    { dow: 4, open: "08:00", close: "16:00" },
    { dow: 5, open: "08:00", close: "16:00" },
  ]);

  const jorge = await upsertCustomer(tenant.id, "Jorge Ramírez", "5588888888", "jorge.ramirez@ejemplo.com");
  const paola = await upsertCustomer(tenant.id, "Paola Herrera", "5599999999", "paola.herrera@ejemplo.com");

  const d1 = futureAt(2, 9, 0);
  await upsertAppointment(tenant.id, principal.id, {
    customerId: jorge.id,
    serviceId: svLimpieza.id,
    startTime: d1,
    endTime: addMinutes(d1, 40),
    status: "CONFIRMED",
    paymentStatus: "paid",
    amountTotal: 500,
    amountPaid: 500,
  });
  const d2 = futureAt(5, 10, 0);
  await upsertAppointment(tenant.id, principal.id, {
    customerId: paola.id,
    serviceId: svExtraccion.id,
    startTime: d2,
    endTime: addMinutes(d2, 60),
    status: "PENDING",
    paymentStatus: "unpaid",
    amountTotal: 900,
    amountPaid: 0,
  });

  return {
    label: "Consultorio Dental Sonríe",
    plan: "PREMIUM",
    tenantCode: tenant.booking_code,
    branches: [{ name: "Principal", code: principal.booking_code }],
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n🌱 Sembrando datos DUMMY para el portal público...\n");

  const results = [];
  results.push(await seedBarberia());
  results.push(await seedSpa());
  results.push(await seedNails());
  results.push(await seedDental());

  console.log("========================================================");
  console.log("  RESUMEN DE NEGOCIOS DUMMY (portal público)");
  console.log("========================================================\n");

  for (const r of results) {
    const branchesStr = r.branches
      .map((b) => `${b.name}=/reservar/${b.code}`)
      .join(" | ");
    console.log(`${r.label} [${r.plan}] tenant=${r.tenantCode} | ${branchesStr}`);
  }

  console.log("\n--------------------------------------------------------");
  console.log("  URLs públicas sugeridas (por sucursal):");
  console.log("--------------------------------------------------------");
  for (const r of results) {
    for (const b of r.branches) {
      console.log(`  ${r.label} - ${b.name}: /reservar/${b.code}`);
    }
  }
  console.log("\n✅ Seed completado (idempotente).\n");
}

main()
  .catch((e) => {
    console.error("❌ Error en el seed:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
