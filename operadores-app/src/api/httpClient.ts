import { create } from 'axios';
import { Platform } from 'react-native';
import { tokenStorage } from '../services/tokenStorage';

export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web'
    ? 'http://localhost:8000/api/v1'
    : 'http://172.20.13.56:8000/api/v1');

export const httpClient = create({
  baseURL: apiBaseUrl,
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
