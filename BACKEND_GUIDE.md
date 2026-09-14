# Guía de Desarrollo Backend

## Estructura del Proyecto

```
backend/
├── src/
│   ├── config/      # Configuración
│   ├── database/    # Base de datos
│   ├── models/      # Modelos de dominio
│   ├── routes/      # Endpoints API
│   │   └── v1/      # Versioned API
│   ├── services/    # Lógica de negocio
│   ├── controllers/ # Handlers HTTP
│   ├── middleware/  # Middleware Express
│   ├── utils/       # Utilidades
│   ├── hooks/       # Prisma hooks
│   ├── queues/      # Job queues
│   └── types/       # Types TypeScript
├── migrations/      # Database migrations
├── tests/           # Tests
└── docker-compose.yml
```

## Convenciones

### Naming

- Services: `serviceName.service.ts` (ej. `auth.service.ts`)
- Controllers: `controllerName.controller.ts` (ej. `user.controller.ts`)
- Routes: `routeName.routes.ts` (ej. `auth.routes.ts`)
- Models: `modelName.model.ts` (ej. `user.model.ts`)
- Middleware: `middlewareName.ts` (ej. `auth.ts`, `error.ts`)

### API Response Format

```json
{
  "success": true,
  "data": {
    "id": "123",
    "name": "John Doe"
  }
}
```

### Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is invalid"
  }
}
```

## Service Layer

```typescript
// services/user.service.ts
export const userService = {
  async getUser(id: string) {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError('User not found', 404, 'NOT_FOUND');
    return user;
  },

  async createUser(data: any) {
    // Validate input
    // Check uniqueness
    // Create user
    // Return result
  },

  async updateUser(id: string, data: any) {
    // Validate input
    // Check existence
    // Update user
    // Return result
  },
};
```

## Controller Layer

```typescript
// controllers/user.controller.ts
export const userController = {
  async get(req: Request, res: Response) {
    try {
      const user = await userService.getUser(req.params.id);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  },

  async create(req: Request, res: Response) {
    try {
      const user = await userService.createUser(req.body);
      res.status(201).json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  },
};
```

## Middleware

```typescript
// middleware/auth.ts
export const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError('Unauthorized', 401, 'AUTH_REQUIRED');
  }

  const token = authHeader.split(' ')[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET!);
  req.user = decoded;
  next();
};
```

## Validation

```typescript
// utils/validators.ts
import { z } from 'zod';

export const UserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
});

export type UserInput = z.infer<typeof UserSchema>;
```

## Testing

### Unit Tests

```typescript
// tests/unit/user.service.test.ts
describe('UserService', () => {
  it('should create user', async () => {
    const user = await userService.createUser(validData);
    expect(user.id).toBeDefined();
  });

  it('should throw error if email exists', async () => {
    await expect(userService.createUser(duplicateData))
      .rejects.toThrow('EMAIL_EXISTS');
  });
});
```

### Integration Tests

```typescript
// tests/integration/user.routes.test.ts
describe('POST /v1/users', () => {
  it('should create user', async () => {
    const response = await request(app).post('/v1/users').send(validData);
    expect(response.status).toBe(201);
  });
});
```

## Database

### Migrations

```bash
# Create migration
pnpm db:migrate:dev --name create_users_table

# Deploy migrations
pnpm db:migrate:deploy

# Open Prisma Studio
pnpm db:studio
```

### Prisma Client

```typescript
// database/prisma.service.ts
export const prisma = new PrismaClient({
  log: ['query', 'error', 'warn'],
});
```

## Environment Variables

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://user:pass@localhost:5432/db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
```
