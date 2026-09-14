# Guía de Desarrollo Frontend

## Estructura del Proyecto

```
frontend/
├── src/
│   ├── components/    # Componentes reutilizables
│   │   ├── common/   # Componentes base
│   │   ├── layout/   # Layouts
│   │   └── calendar/ # Componentes del calendario
│   ├── screens/      # Pantallas de la app
│   ├── navigation/   # Configuración de navegación
│   ├── store/        # Gestión de estado
│   ├── services/     # Servicios API
│   ├── utils/        # Utilidades
│   ├── hooks/        # Custom hooks
│   ├── theme/        # Design System
│   └── types/        # Types TypeScript
└── __tests__/        # Tests E2E
```

## Convenciones

### Naming

- Componentes: PascalCase (ej. `DashboardScreen`)
- Hooks: useCamelCase (ej. `useAuthStore`)
- Constants: UPPER_SNAKE_CASE (ej. `API_BASE_URL`)
- Variables: camelCase (ej. `userName`)
- Types: PascalCase con prefijo (ej. `User`, `AppointmentStatus`)

### Import Ordering

1. React y hooks
2. Third-party libraries
3. Services
4. Components
5. Hooks
6. Utils
7. Types

### Styling

- Usar StyleSheet para estilos
- Variables de tema en `theme/`
- Responsive con `Dimensions`
- Dark mode support

## Componentes Base

### Button

```tsx
<Button
  title="Click me"
  variant="primary"
  onPress={handlePress}
  disabled={loading}
/>
```

### Input

```tsx
<Input
  label="Email"
  value={email}
  onChangeText={setEmail}
  placeholder="Enter email"
  error={error}
/>
```

### Card

```tsx
<Card onPress={handlePress}>
  <Card.Content>
    <Text>Title</Text>
    <Text>Subtitle</Text>
  </Card.Content>
</Card>
```

## Store Pattern

### Auth Store

```tsx
import { useAuthStore } from '../store/useAuthStore';

const { user, login, logout, isAuthenticated } = useAuthStore();
```

### Theme Store

```tsx
import { useThemeStore } from '../store/useThemeStore';

const { theme, toggleTheme } = useThemeStore();
```

## Testing

```bash
# Unit tests
npm test

# E2E tests
npm run test:e2e

# Coverage
npm run test:coverage
```

## Performance

- Usar `React.memo` para componentes pesados
- Lazy loading con `React.lazy`
- Virtualización con `FlatList`
- Optimizar re-renders con `useCallback` y `useMemo`

## Navigation

```tsx
import { useNavigation } from '@react-navigation/native';

const navigation = useNavigation();

// Navigate
navigation.navigate('ScreenName', { param: value });

// Go back
navigation.goBack();

// Reset
navigation.reset({
  index: 0,
  routes: [{ name: 'ScreenName' }],
});
```
