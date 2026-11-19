import { Platform } from 'react-native';
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
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
    return false;
  }
  if (!areNativeNotificationsAvailable()) {
    throw new Error('Las notificaciones remotas requieren la aplicación instalada, no Expo Go.');
  }

  const permissionGranted = await requestNotificationPermission();
  if (!permissionGranted) {
    throw new Error(
      'Permite las notificaciones en los ajustes del dispositivo para recibir avisos de novedades y tareas.',
    );
  }

  const pushToken = await getExpoPushToken();
  if (!pushToken) {
    throw new Error('No se pudo obtener el token de notificaciones del dispositivo.');
  }
  const previousToken = await tokenStorage.getPushToken();

  const response = await httpClient.post<RegisterPushTokenResponse>(
    '/novedades/push-tokens',
    {
      expo_push_token: pushToken,
      plataforma: Platform.OS,
    },
  );

  if (!response.data.registrado) {
    throw new Error('El backend no confirmó el registro del dispositivo.');
  }

  if (previousToken && previousToken !== pushToken) {
    await httpClient.delete('/novedades/push-tokens', {
      data: { expo_push_token: previousToken },
    });
  }
  await tokenStorage.savePushToken(pushToken);
  return true;
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
