import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { HttpError } from '../../src/utils/errors';

// Mock Prisma
const mockPrisma = {
  service: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  category: {
    findMany: jest.fn(),
    create: jest.fn(),
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

describe('ServiceService', () => {
  const tenantId = 'tenant-123';

  describe('listServices', () => {
    it('should list services with optional filters', async () => {
      const mockServices = [
        { id: '1', name: 'Service 1', is_active: true },
        { id: '2', name: 'Service 2', is_active: true },
      ];
      mockPrisma.service.findMany.mockResolvedValue(mockServices);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.listServices(tenantId, undefined, true)
      );

      expect(result).toHaveLength(2);
    });

    it('should filter by category and active status', async () => {
      const mockServices = [{ id: '1', name: 'Service 1' }];
      mockPrisma.service.findMany.mockResolvedValue(mockServices);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.listServices(tenantId, 'category-1', false)
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('getService', () => {
    it('should return service if exists', async () => {
      const mockService = {
        id: '1',
        name: 'Service 1',
        tenant_id: tenantId,
        category: { id: 'cat-1', name: 'Category 1' },
      };
      mockPrisma.service.findUnique.mockResolvedValue(mockService);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.getService(tenantId, '1')
      );

      expect(result).toEqual(mockService);
    });

    it('should throw error if service not found', async () => {
      mockPrisma.service.findUnique.mockResolvedValue(null);

      await expect(
        import('../../src/services/service.service').then(m => 
          m.serviceService.getService(tenantId, 'nonexistent')
        )
      ).rejects.toThrow('Service not found');
    });
  });

  describe('createService', () => {
    it('should create a new service', async () => {
      const mockService = {
        id: '1',
        name: 'New Service',
        duration: 30,
        price: 25.00,
        tenant_id: tenantId,
      };
      mockPrisma.service.create.mockResolvedValue(mockService);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.createService(tenantId, {
          name: 'New Service',
          duration: 30,
          price: 25.00,
        })
      );

      expect(result).toEqual(mockService);
    });
  });

  describe('updateService', () => {
    it('should update service', async () => {
      const mockExistingService = {
        id: '1',
        name: 'Service 1',
        tenant_id: tenantId,
      };
      const mockUpdatedService = {
        id: '1',
        name: 'Updated Service',
        tenant_id: tenantId,
      };
      mockPrisma.service.findUnique.mockResolvedValue(mockExistingService);
      mockPrisma.service.update.mockResolvedValue(mockUpdatedService);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.updateService(tenantId, '1', { name: 'Updated Service' })
      );

      expect(result).toEqual(mockUpdatedService);
    });
  });

  describe('deleteService', () => {
    it('should soft delete service', async () => {
      const mockService = {
        id: '1',
        name: 'Service 1',
        tenant_id: tenantId,
      };
      const mockUpdatedService = {
        ...mockService,
        is_active: false,
      };
      mockPrisma.service.findUnique.mockResolvedValue(mockService);
      mockPrisma.service.update.mockResolvedValue(mockUpdatedService);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.deleteService(tenantId, '1')
      );

      expect(result.is_active).toBe(false);
    });
  });

  describe('listCategories', () => {
    it('should list categories', async () => {
      const mockCategories = [
        { id: '1', name: 'Category 1' },
        { id: '2', name: 'Category 2' },
      ];
      mockPrisma.category.findMany.mockResolvedValue(mockCategories);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.listCategories(tenantId)
      );

      expect(result).toHaveLength(2);
    });
  });

  describe('createCategory', () => {
    it('should create a new category', async () => {
      const mockCategory = {
        id: '1',
        name: 'New Category',
        tenant_id: tenantId,
      };
      mockPrisma.category.create.mockResolvedValue(mockCategory);

      const result = await import('../../src/services/service.service').then(m => 
        m.serviceService.createCategory(tenantId, { name: 'New Category' })
      );

      expect(result).toEqual(mockCategory);
    });
  });
});
