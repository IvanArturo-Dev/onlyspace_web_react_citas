import { prisma } from './prisma.service';
import { assignUniqueBranchCode } from '../utils/bookingCode';

/**
 * Resultado agregado del backfill, util para logging y pruebas.
 */
export interface BackfillResult {
  tenantsProcessed: number;
  branchesCreated: number;
  servicesUpdated: number;
  appointmentsUpdated: number;
  schedulesUpdated: number;
}

/**
 * Migracion idempotente que introduce el concepto de sucursal (Branch) para los
 * negocios (Tenant) existentes.
 *
 * Para cada Tenant:
 *  - Si NO tiene ninguna Branch, crea una Branch "Principal" activa. El
 *    `booking_code` se HEREDA del tenant (si tenia) para preservar los enlaces
 *    publicos existentes; si el tenant no tenia codigo, se genera uno nuevo
 *    unico contra `Branch.booking_code`.
 *  - Toma la Branch principal del tenant (la recien creada o la primera
 *    existente) y asigna su `id` como `branch_id` a los `Service`,
 *    `Appointment` y `Schedule` del tenant que aun no tengan sucursal.
 *
 * Al heredar el codigo del tenant no hay colision: la relacion tenant->branch es
 * 1:1 en este backfill y el tenant deja de usar su codigo para resolver el
 * portal publico (la resolucion pasa a `Branch.booking_code`).
 *
 * Es seguro ejecutarlo multiples veces: solo crea branches faltantes y solo
 * actualiza filas cuyo `branch_id` es null.
 */
export async function backfillBranches(client = prisma): Promise<BackfillResult> {
  const result: BackfillResult = {
    tenantsProcessed: 0,
    branchesCreated: 0,
    servicesUpdated: 0,
    appointmentsUpdated: 0,
    schedulesUpdated: 0,
  };

  const tenants = await client.tenant.findMany();

  for (const tenant of tenants) {
    result.tenantsProcessed += 1;

    // 1) Asegurar una Branch principal para el tenant.
    let branch = await client.branch.findFirst({
      where: { tenant_id: tenant.id },
      orderBy: { created_at: 'asc' },
    });

    if (!branch) {
      // Hereda el codigo del tenant si existe; si no, genera uno nuevo unico.
      const bookingCode = tenant.booking_code
        ? tenant.booking_code
        : await assignUniqueBranchCode(client);

      branch = await client.branch.create({
        data: {
          tenant_id: tenant.id,
          name: 'Principal',
          status: 'active',
          booking_code: bookingCode,
        },
      });
      result.branchesCreated += 1;
      console.log(
        ` ✅ Branch "Principal" creada para tenant ${tenant.id} (${tenant.name}) con codigo ${bookingCode}`
      );
    } else {
      console.log(
        ` ✅ Tenant ${tenant.id} (${tenant.name}) ya tiene sucursal (${branch.id})`
      );
    }

    // 2) Asignar branch_id a los datos operativos sin sucursal.
    const services = await client.service.updateMany({
      where: { tenant_id: tenant.id, branch_id: null },
      data: { branch_id: branch.id },
    });
    result.servicesUpdated += services.count;

    const appointments = await client.appointment.updateMany({
      where: { tenant_id: tenant.id, branch_id: null },
      data: { branch_id: branch.id },
    });
    result.appointmentsUpdated += appointments.count;

    const schedules = await client.schedule.updateMany({
      where: { tenant_id: tenant.id, branch_id: null },
      data: { branch_id: branch.id },
    });
    result.schedulesUpdated += schedules.count;
  }

  console.log('\n Backfill completado:');
  console.log(`  - Tenants procesados:    ${result.tenantsProcessed}`);
  console.log(`  - Branches creadas:      ${result.branchesCreated}`);
  console.log(`  - Services actualizados: ${result.servicesUpdated}`);
  console.log(`  - Appointments actualizados: ${result.appointmentsUpdated}`);
  console.log(`  - Schedules actualizados: ${result.schedulesUpdated}`);

  return result;
}

// Execute as a script when run directly.
if (require.main === module) {
  backfillBranches()
    .catch((e) => {
      console.error('Error en backfill de sucursales:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
