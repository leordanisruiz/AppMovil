# AppMovil

Monorepo for the AppMovil backend API and operator mobile application.

## Projects

- [`backend/`](./backend/): API and push-notification worker. The FastAPI project lives in [`backend/backend/`](./backend/backend/); see its [README](./backend/backend/README.md) for setup, environment variables, API contracts, and deployment details.
- [`operadores-app/`](./operadores-app/): Expo React Native application, web frontend, and EAS build configuration.

## Common commands

- Start the frontend: `cd operadores-app` then `npm ci` and `npx expo start`.
- Build the Android APK with EAS: from `operadores-app/`, run `npx eas-cli@latest build --platform android --profile preview`.
- Start the API, push worker, and web frontend together: from the repository root, run `docker compose up --build`.

Local environment files, credentials, dependency directories, and generated build output are excluded from version control.

Prueba GitHub Actions
