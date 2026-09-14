import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../src/utils/errors';

// Mock Prisma
const mockPrisma = {
  customer: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

// Mock dependencies
jest.mock('../../src/database/prisma.service', () => ({
  prisma: mockPrisma,
}));

jest.mock('../../src/utils/errors', () => ({
  HttpError: class HttpError extends Error {
    constructor(message: string, statusCode: number, code: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
    statusCode: number;
    code: string;
  },
}));

describe('CustomerService', () => {
  const tenantId = 'tenant-123';

  describe('listCustomers', () => {
    it('should list customers with pagination', async () => {
      const mockCustomers = [
        { id: '1', name: 'John Doe', email: 'john@example.com' },
        { id: '2', name: 'Jane Smith', email: 'jane@example.com' },
      ];
      mockPrisma.customer.findMany.mockResolvedValue(mockCustomers);
      mockPrisma.customer.count.mockResolvedValue(2);

      const result = await import('../../src/services/customer.service').then(m => 
        m.customerService.listCustomers(tenantId, '', 1, 10)
      );

      expect(result.customers).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('should search by name', async () => {
      mockPrisma.customer.findMany.mockResolvedValue([]);
      mockPrisma.customer.count.mockResolvedValue(0);

      const result = await import('../../src/services/customer.service').then(m => 
        m.customerService.listCustomers(tenantId, 'John', 1, 10)
      );

      expect(result.customers).toHaveLength(0);
    });
  });

  describe('getCustomer', () => {
    it('should return customer if exists', async () => {
      const mockCustomer = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        tenant_id: tenantId,
      };
      mockPrisma.customer.findUnique.mockResolvedValue(mockCustomer);

      const result = await import('../../src/services/customer.service').then(m => 
        m.customerService.getCustomer(tenantId, '1')
      );

      expect(result).toEqual(mockCustomer);
    });

    it('should throw error if customer not found', async () => {
      mockPrisma.customer.findUnique.mockResolvedValue(null);

      await expect(
        import('../../src/services/customer.service').then(m => 
          m.customerService.getCustomer(tenantId, 'nonexistent')
        )
      ).rejects.toThrow('Customer not found');
    });
  });

  describe('createCustomer', () => {
    it('should create a new customer', async () => {
      const mockCustomer = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        tenant_id: tenantId,
      };
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.create.mockResolvedValue(mockCustomer);

      const result = await import('../../src/services/customer.service').then(m => 
        m.customerService.createCustomer(tenantId, {
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
        })
      );

      expect(result).toEqual(mockCustomer);
    });

    it('should throw error if email already exists', async () => {
      mockPrisma.customer.findFirst.mockResolvedValue({ id: '2' });

      await expect(
        import('../../src/services/customer.service').then(m => 
          m.customerService.createCustomer(tenantId, {
            name: 'John Doe',
            email: 'existing@example.com',
          })
        )
      ).rejects.toThrow('Email already exists');
    });

    it('should throw error if phone already exists', async () => {
      // Sin email en el payload, el servicio solo consulta el telefono (una unica
      // llamada a findFirst): esa llamada debe devolver el duplicado.
      mockPrisma.customer.findFirst.mockResolvedValue({ id: '2' });

      await expect(
        import('../../src/services/customer.service').then(m => 
          m.customerService.createCustomer(tenantId, {
            name: 'John Doe',
            phone: '+1234567890',
          })
        )
      ).rejects.toThrow('Phone already exists');
    });
  });

  describe('updateCustomer', () => {
    it('should update customer', async () => {
      const mockExistingCustomer = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        tenant_id: tenantId,
      };
      const mockUpdatedCustomer = {
        id: '1',
        name: 'John Updated',
        email: 'john@example.com',
        tenant_id: tenantId,
      };
      mockPrisma.customer.findUnique.mockResolvedValue(mockExistingCustomer);
      mockPrisma.customer.findFirst.mockResolvedValue(null);
      mockPrisma.customer.update.mockResolvedValue(mockUpdatedCustomer);

      const result = await import('../../src/services/customer.service').then(m => 
        m.customerService.updateCustomer(tenantId, '1', { name: 'John Updated' })
      );

      expect(result).toEqual(mockUpdatedCustomer);
    });
  });

  describe('deleteCustomer', () => {
    it('should soft delete customer', async () => {
      const mockCustomer = {
        id: '1',
        name: 'John Doe',
        email: 'john@example.com',
        tenant_id: tenantId,
      };
      const mockUpdatedCustomer = {
        ...mockCustomer,
        status: 'inactive',
      };
      mockPrisma.customer.findUnique.mockResolvedValue(mockCustomer);
      mockPrisma.customer.update.mockResolvedValue(mockUpdatedCustomer);

      const result = await import('../../src/services/customer.service').then(m => 
        m.customerService.deleteCustomer(tenantId, '1')
      );

      expect(result.status).toBe('inactive');
    });
  });
});
