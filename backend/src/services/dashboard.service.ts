import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

export const dashboardService = {
  async getDashboardStats(tenantId: string, startDate?: string, endDate?: string) {
    const where: any = { tenant_id: tenantId };

    if (startDate && endDate) {
      where.created_at = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    // Count customers
    const totalCustomers = await prisma.customer.count({ where });

    // Count services
    const totalServices = await prisma.service.count({ where });

    // Count appointments
    const totalAppointments = await prisma.appointment.count({ where });

    // Count completed appointments
    const completedAppointments = await prisma.appointment.count({
      where: {
        tenant_id: tenantId,
        status: 'COMPLETED',
        ...(startDate && endDate && {
          created_at: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        }),
      },
    });

    // Count cancelled appointments
    const cancelledAppointments = await prisma.appointment.count({
      where: {
        tenant_id: tenantId,
        status: 'CANCELLED',
        ...(startDate && endDate && {
          created_at: {
            gte: new Date(startDate),
            lte: new Date(endDate),
          },
        }),
      },
    });

    // Count professionals (through User relationship)
    const totalProfessionals = await prisma.professional.count({
      where: {
        user: {
          tenant_id: tenantId,
        },
      },
    });

    // Calculate total income from completed appointments (using raw query)
    const whereClause = startDate && endDate 
      ? `AND a.created_at >= '${new Date(startDate)}' AND a.created_at <= '${new Date(endDate)}'` 
      : '';
    const incomeResult: any = await prisma.$queryRaw`
      SELECT COALESCE(SUM(s.price), 0) as total
      FROM appointments a
      JOIN services s ON a.service_id = s.id
      WHERE a.tenant_id = ${tenantId}
        AND a.status = 'COMPLETED'
        ${whereClause}
    `;

    // Get pending appointments count
    const pendingAppointments = await prisma.appointment.count({
      where: {
        tenant_id: tenantId,
        status: 'PENDING',
      },
    });

    return {
      total_customers: totalCustomers,
      total_services: totalServices,
      total_appointments: totalAppointments,
      completed_appointments: completedAppointments,
      cancelled_appointments: cancelledAppointments,
      total_professionals: totalProfessionals,
      total_income: incomeResult[0]?.total ? parseFloat(incomeResult[0].total.toString()) : 0,
      pending_appointments: pendingAppointments,
    };
  },

  async getAppointmentsTrend(tenantId: string, startDate: string, endDate: string) {
    const appointments = await prisma.$queryRaw`
      SELECT 
        DATE(start_time) as date,
        COUNT(*) as total,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) as confirmed
      FROM appointments
      WHERE tenant_id = ${tenantId}
        AND start_time >= ${new Date(startDate)}
        AND start_time < ${new Date(endDate)}
      GROUP BY DATE(start_time)
      ORDER BY date DESC
    `;

    return appointments;
  },

  async getServicesPopularity(tenantId: string, startDate?: string, endDate?: string) {
    const where: any = { tenant_id: tenantId };

    if (startDate && endDate) {
      where.created_at = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }

    const services = await prisma.service.findMany({
      where: {
        tenant_id: tenantId,
        appointments: {
          some: where,
        },
      },
      include: {
        appointments: {
          where,
          select: {
            id: true,
            status: true,
          },
        },
      },
      orderBy: {
        appointments: {
          _count: 'desc',
        },
      },
      take: 10,
    });

    return services.map(service => ({
      id: service.id,
      name: service.name,
      description: service.description,
      duration: service.duration_mins,
      price: service.price,
      total_appointments: service.appointments.length,
      completed_appointments: service.appointments.filter(a => a.status === 'COMPLETED').length,
      cancelled_appointments: service.appointments.filter(a => a.status === 'CANCELLED').length,
    }));
  },

  async getIncome(tenantId: string, startDate: string, endDate: string) {
    // Get income using raw query
    const result: any = await prisma.$queryRaw`
      SELECT 
        COALESCE(SUM(s.price), 0) as total,
        COUNT(a.id) as appointments_count
      FROM appointments a
      JOIN services s ON a.service_id = s.id
      WHERE a.tenant_id = ${tenantId}
        AND a.status = 'COMPLETED'
        AND a.created_at >= ${new Date(startDate)}
        AND a.created_at < ${new Date(endDate)}
    `;

    // Get daily breakdown using raw query
    const dailyIncome: any = await prisma.$queryRaw`
      SELECT 
        DATE(a.start_time) as date,
        COUNT(a.id) as appointments,
        SUM(s.price) as total,
        AVG(CAST(s.price AS FLOAT)) as average
      FROM appointments a
      JOIN services s ON a.service_id = s.id
      WHERE a.tenant_id = ${tenantId}
        AND a.status = 'COMPLETED'
        AND a.created_at >= ${new Date(startDate)}
        AND a.created_at < ${new Date(endDate)}
      GROUP BY DATE(a.start_time)
      ORDER BY date DESC
    `;

    return {
      total: result[0]?.total ? parseFloat(result[0].total.toString()) : 0,
      appointments_count: result[0]?.appointments_count || 0,
      average: result[0]?.appointments_count && result[0]?.total 
        ? parseFloat(result[0].total.toString()) / result[0].appointments_count 
        : 0,
      daily_breakdown: dailyIncome,
    };
  },

  async getOccupancy(tenantId: string, startDate: string, endDate: string) {
    // Get appointments grouped by day
    const appointments = await prisma.appointment.findMany({
      where: {
        tenant_id: tenantId,
        start_time: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      select: {
        start_time: true,
        end_time: true,
        professional_id: true,
        status: true,
      },
    });

    // Calculate occupancy for each day
    const occupancy: any = {};
    const oneDay = 24 * 60 * 60 * 1000;

    for (let d = new Date(startDate); d <= new Date(endDate); d.setTime(d.getTime() + oneDay)) {
      const dateStr = d.toISOString().split('T')[0];
      occupancy[dateStr] = {
        total_minutes: 0,
        occupied_minutes: 0,
        utilization: 0,
        appointments: [],
      };

      // Get business hours (9 AM to 6 PM = 540 minutes)
      const businessMinutes = 540;
      const dayAppointments = appointments.filter(appt => {
        const apptDate = new Date(appt.start_time).toISOString().split('T')[0];
        return apptDate === dateStr;
      });

      let totalDuration = 0;
      dayAppointments.forEach(appt => {
        const start = new Date(appt.start_time).getTime();
        const end = new Date(appt.end_time).getTime();
        const duration = (end - start) / 1000 / 60;
        totalDuration += duration;

        occupancy[dateStr].appointments.push({
          start_time: appt.start_time,
          end_time: appt.end_time,
          professional_id: appt.professional_id,
          status: appt.status,
        });
      });

      occupancy[dateStr].total_minutes = totalDuration;
      occupancy[dateStr].occupied_minutes = totalDuration;
      occupancy[dateStr].utilization = Math.min(100, (totalDuration / businessMinutes) * 100);
    }

    return occupancy;
  },

  /**
   * Series mensuales de comportamiento de citas de los ultimos N meses.
   * Agrega por mes de start_time contando COMPLETED (attended), CANCELLED y NO_SHOW.
   * Devuelve un array ascendente por mes: [{ month: 'YYYY-MM', attended, cancelled, no_show }].
   * Query raw parametrizada por tenantId (sin interpolacion de strings) para evitar inyeccion.
   */
  async getMonthlyBehavior(tenantId: string, months: number = 6) {
    // Sanitizar el numero de meses: entero >= 1. Se usa como INTERVAL, por eso
    // debe validarse; nunca proviene de un string interpolado sin control.
    const safeMonths = Number.isFinite(months) && months > 0 ? Math.floor(months) : 6;

    // Limite inferior: primer dia del mes que queda (safeMonths - 1) meses atras.
    const now = new Date();
    const startBoundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (safeMonths - 1), 1, 0, 0, 0));

    const rows: any = await prisma.$queryRaw`
      SELECT
        DATE_FORMAT(start_time, '%Y-%m') as month,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as attended,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN status = 'NO_SHOW' THEN 1 ELSE 0 END) as no_show
      FROM appointments
      WHERE tenant_id = ${tenantId}
        AND start_time >= ${startBoundary}
      GROUP BY DATE_FORMAT(start_time, '%Y-%m')
      ORDER BY month ASC
    `;

    return rows.map((r: any) => ({
      month: r.month,
      attended: Number(r.attended) || 0,
      cancelled: Number(r.cancelled) || 0,
      no_show: Number(r.no_show) || 0,
    }));
  },

  /**
   * Rankings de clientes del tenant.
   * - topAttendance: top N por citas COMPLETED.
   * - topNoShow: top N por citas NO_SHOW.
   * - topRewards: top N por recompensas de lealtad. Se cuentan EARNED + CLAIMED
   *   (recompensas efectivamente obtenidas por el cliente); se excluyen EXPIRED
   *   porque representan recompensas que caducaron sin uso y no reflejan fidelidad.
   * Todas las consultas estan scoped por tenant y parametrizadas por tenantId.
   */
  async getClientRankings(tenantId: string, limit: number = 5) {
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;

    const topAttendance: any = await prisma.$queryRaw`
      SELECT a.customer_id as customer_id, c.name as name, COUNT(*) as count
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.tenant_id = ${tenantId}
        AND a.status = 'COMPLETED'
      GROUP BY a.customer_id, c.name
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;

    const topNoShow: any = await prisma.$queryRaw`
      SELECT a.customer_id as customer_id, c.name as name, COUNT(*) as count
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE a.tenant_id = ${tenantId}
        AND a.status = 'NO_SHOW'
      GROUP BY a.customer_id, c.name
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;

    const topRewards: any = await prisma.$queryRaw`
      SELECT lr.customer_id as customer_id, c.name as name, COUNT(*) as count
      FROM loyalty_rewards lr
      JOIN customers c ON c.id = lr.customer_id
      WHERE lr.tenant_id = ${tenantId}
        AND lr.status IN ('EARNED', 'CLAIMED')
      GROUP BY lr.customer_id, c.name
      ORDER BY count DESC
      LIMIT ${safeLimit}
    `;

    const mapRow = (r: any) => ({
      customer_id: r.customer_id,
      name: r.name,
      count: Number(r.count) || 0,
    });

    return {
      topAttendance: topAttendance.map(mapRow),
      topNoShow: topNoShow.map(mapRow),
      topRewards: topRewards.map(mapRow),
    };
  },

  async getReport(tenantId: string, type: string, startDate: string, endDate: string) {
    switch (type) {
      case 'appointments':
        return this.getAppointmentsTrend(tenantId, startDate, endDate);
      case 'services':
        return this.getServicesPopularity(tenantId, startDate, endDate);
      case 'income':
        return this.getIncome(tenantId, startDate, endDate);
      case 'occupancy':
        return this.getOccupancy(tenantId, startDate, endDate);
      case 'summary':
        return this.getDashboardStats(tenantId, startDate, endDate);
      default:
        throw new HttpError('Invalid report type', 400, 'INVALID_REPORT_TYPE');
    }
  },
};
