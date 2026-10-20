import { create } from 'axios';
import { tokenStorage } from '../services/tokenStorage';

// export const httpClient = create({
//   baseURL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api/v1',
//   timeout: 15_000,
//   headers: {
//     Accept: 'application/json',
//     'Content-Type': 'application/json',
//   },
// });

export const httpClient = create({
  baseURL: process.env.EXPO_PUBLIC_API_URL ??
    'http://172.20.12.174:8000/api/v1',
  timeout: 15000,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

httpClient.interceptors.request.use(async (config) => {
  const token = await tokenStorage.get();

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});
