import { prisma } from '../database/prisma.service';
import { HttpError } from '../utils/errors';

export const customerService = {
  async listCustomers(tenantId: string, search: string = '', page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const customers = await prisma.customer.findMany({
      where: {
        tenant_id: tenantId,
        status: 'active',
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
        ],
      },
      skip,
      take: limit,
      orderBy: { created_at: 'desc' },
    });

    const total = await prisma.customer.count({
      where: {
        tenant_id: tenantId,
        status: 'active',
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
        ],
      },
    });

    return { customers, total, page, limit };
  },

  async getCustomer(tenantId: string, customerId: string) {
    const customer = await prisma.customer.findUnique({
      where: { id: customerId, tenant_id: tenantId },
    });

    if (!customer) {
      throw new HttpError('Customer not found', 404, 'CUSTOMER_NOT_FOUND');
    }

    return customer;
  },

  async createCustomer(tenantId: string, data: any) {
    const { email, phone } = data;

    // Check if email already exists
    if (email) {
      const existing = await prisma.customer.findFirst({
        where: { tenant_id: tenantId, email },
      });
      if (existing) {
        throw new HttpError('Email already exists', 409, 'EMAIL_EXISTS');
      }
    }

    // Check if phone already exists
    const existingPhone = await prisma.customer.findFirst({
      where: { tenant_id: tenantId, phone },
    });
    if (existingPhone) {
      throw new HttpError('Phone already exists', 409, 'PHONE_EXISTS');
    }

    return prisma.customer.create({
      data: {
        tenant_id: tenantId,
        ...data,
      },
    });
  },

  async updateCustomer(tenantId: string, customerId: string, data: any) {
    await this.getCustomer(tenantId, customerId);

    // Check email uniqueness if changing
    if (data.email) {
      const existing = await prisma.customer.findFirst({
        where: {
          tenant_id: tenantId,
          email: data.email,
          id: { not: customerId },
        },
      });
      if (existing) {
        throw new HttpError('Email already exists', 409, 'EMAIL_EXISTS');
      }
    }

    return prisma.customer.update({
      where: { id: customerId, tenant_id: tenantId },
      data,
    });
  },

  async deleteCustomer(tenantId: string, customerId: string) {
    await this.getCustomer(tenantId, customerId);
    return prisma.customer.update({
      where: { id: customerId, tenant_id: tenantId },
      data: { status: 'inactive' },
    });
  },
};
