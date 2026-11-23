import { Platform } from 'react-native';
import { isAxiosError } from 'axios';
import { httpClient } from '../api/httpClient';
import {
  areNativeNotificationsAvailable,
  getExpoPushToken,
  requestNotificationPermission,
} from './notificationService';
import { tokenStorage } from './tokenStorage';

type RegisterPushTokenResponse = {
  registrado: boolean;
};

export async function registerDeviceForPushNotifications(): Promise<boolean> {
  let stage = 'validar la plataforma';

  try {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return false;
    }
    stage = 'validar disponibilidad de notificaciones nativas';
    if (!areNativeNotificationsAvailable()) {
      throw new Error('Las notificaciones remotas requieren la aplicación instalada, no Expo Go.');
    }

    stage = 'solicitar permiso y preparar canales';
    const permissionGranted = await requestNotificationPermission();
    if (!permissionGranted) {
      throw new Error(
        'Permite las notificaciones en los ajustes del dispositivo para recibir avisos de novedades y tareas.',
      );
    }

    stage = 'obtener el token de Expo';
    const pushToken = await getExpoPushToken();
    if (!pushToken) {
      throw new Error('Expo no devolvió un token para este dispositivo.');
    }

    stage = 'leer el token previamente guardado';
    const previousToken = await tokenStorage.getPushToken();

    stage = 'enviar el token al backend';
    const response = await httpClient.post<RegisterPushTokenResponse>(
      '/novedades/push-tokens',
      {
        expo_push_token: pushToken,
        plataforma: Platform.OS,
      },
    );

    stage = 'validar la respuesta del backend';
    if (!response.data.registrado) {
      throw new Error('El backend no confirmó el registro del dispositivo.');
    }

    if (previousToken && previousToken !== pushToken) {
      stage = 'desactivar el token anterior';
      await httpClient.delete('/novedades/push-tokens', {
        data: { expo_push_token: previousToken },
      });
    }

    stage = 'guardar el token localmente';
    await tokenStorage.savePushToken(pushToken);
    console.info('[push] Registro completado.');
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const status = isAxiosError(error) ? error.response?.status : undefined;
    const responseDetail = isAxiosError(error)
      ? error.response?.data?.detail
      : undefined;
    const detail = typeof responseDetail === 'string'
      ? `HTTP ${status ?? 'sin estado'}: ${responseDetail}`
      : status
        ? `HTTP ${status}: ${message}`
        : message;

    // Never log the Expo token or Axios request config; both can contain credentials.
    console.error(`[push] Fallo en etapa "${stage}".`, {
      name: error instanceof Error ? error.name : typeof error,
      message,
      status,
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw new Error(`Registro push detenido al ${stage}: ${detail}`);
  }
}

export async function deactivateDevicePushNotifications(): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  const pushToken = await tokenStorage.getPushToken();
  if (!pushToken) return;

  await httpClient.delete('/novedades/push-tokens', {
    data: { expo_push_token: pushToken },
  });

  await tokenStorage.clearPushToken();
}
