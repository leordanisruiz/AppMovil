import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AUTH_TOKEN_EXPIRES_AT_STORAGE_KEY,
  AUTH_OPERATOR_STORAGE_KEY,
  AUTH_TOKEN_STORAGE_KEY,
  EXPO_PUSH_TOKEN_STORAGE_KEY,
} from '../constants/storage';
import type { Operador } from '../types/operador';

function isOperator(value: unknown): value is Operador {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const operator = value as Record<string, unknown>;
  return (
    (typeof operator.codigo === 'string' || operator.codigo === null) &&
    typeof operator.tipoDocumento === 'string' &&
    typeof operator.identificacion === 'string' &&
    (typeof operator.nombreCompleto === 'string' ||
      operator.nombreCompleto === null) &&
    (typeof operator.fechaIngreso === 'string' ||
      operator.fechaIngreso === null) &&
    (typeof operator.cargo === 'string' || operator.cargo === null) &&
    typeof operator.estadoEmpleado === 'string' &&
    (typeof operator.rolId === 'number' ||
      operator.rolId === null ||
      operator.rolId === undefined)
  );
}

export const tokenStorage = {
  async get(): Promise<string | null> {
    return AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  },

  async getExpiresAt(): Promise<number | null> {
    const value = await AsyncStorage.getItem(AUTH_TOKEN_EXPIRES_AT_STORAGE_KEY);
    if (value === null) return null;

    const expiresAt = Number(value);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
      throw new Error('La fecha de expiración del token no es válida.');
    }

    return expiresAt;
  },

  async getPushToken(): Promise<string | null> {
    return AsyncStorage.getItem(EXPO_PUSH_TOKEN_STORAGE_KEY);
  },

  async savePushToken(pushToken: string): Promise<void> {
    await AsyncStorage.setItem(EXPO_PUSH_TOKEN_STORAGE_KEY, pushToken);
  },

  async clearPushToken(): Promise<void> {
    await AsyncStorage.removeItem(EXPO_PUSH_TOKEN_STORAGE_KEY);
  },

  async getOperator(): Promise<Operador | null> {
    const value = await AsyncStorage.getItem(AUTH_OPERATOR_STORAGE_KEY);
    if (!value) {
      return null;
    }

    const operator: unknown = JSON.parse(value);
    return isOperator(operator)
      ? { ...operator, rolId: operator.rolId ?? null }
      : null;
  },

  async saveSession(
    token: string,
    operator: Operador,
    expiresInSeconds: number,
  ): Promise<void> {
    if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
      throw new Error('El tiempo de expiración del token no es válido.');
    }

    await AsyncStorage.multiSet([
      [AUTH_TOKEN_STORAGE_KEY, token],
      [
        AUTH_TOKEN_EXPIRES_AT_STORAGE_KEY,
        String(Date.now() + expiresInSeconds * 1000),
      ],
      [AUTH_OPERATOR_STORAGE_KEY, JSON.stringify(operator)],
    ]);
  },

  async clear(): Promise<void> {
    await AsyncStorage.multiRemove([
      AUTH_TOKEN_STORAGE_KEY,
      AUTH_TOKEN_EXPIRES_AT_STORAGE_KEY,
      AUTH_OPERATOR_STORAGE_KEY,
      EXPO_PUSH_TOKEN_STORAGE_KEY,
    ]);
  },
};
