import { create } from 'axios';
import { Platform } from 'react-native';
import { tokenStorage } from '../services/tokenStorage';

export const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === 'web'
    ? 'http://localhost:8000/api/v1'
    : 'http://172.20.13.56:8000/api/v1');

console.log('EXPO_PUBLIC_API_URL=', process.env.EXPO_PUBLIC_API_URL);
console.log('API URL=', apiBaseUrl);

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

  // Let the browser set the multipart boundary for FormData uploads. The
  // shared JSON default would otherwise make Axios serialize FormData as JSON.
  if (
    Platform.OS === 'web' &&
    typeof FormData !== 'undefined' &&
    config.data instanceof FormData
  ) {
    config.headers.delete('Content-Type');
  }

  return config;
});
