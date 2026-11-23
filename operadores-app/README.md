# Operadores App

Aplicación Expo/React Native para Android, iOS y web.

## Desarrollo

```bash
npm ci
npx expo start
```

## APK con EAS

Ejecuta desde esta carpeta:

```bash
npx eas-cli@latest build --platform android --profile preview
```

La URL del backend se configura con `EXPO_PUBLIC_API_URL` en `.env` para el
desarrollo local y en el entorno `preview` de EAS para las compilaciones.

## Frontend web en Docker

El `Dockerfile` de esta carpeta exporta el sitio web y lo sirve con Nginx. El
`docker-compose.yml` de la raíz del repositorio lo construye junto con la API y
el worker de notificaciones.
