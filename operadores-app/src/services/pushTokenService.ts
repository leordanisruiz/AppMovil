import { Platform } from 'react-native';
import { httpClient } from '../api/httpClient';
import { getExpoPushToken, requestNotificationPermission } from './notificationService';
import { tokenStorage } from './tokenStorage';

type RegisterPushTokenResponse = {
  registrado: boolean;
};

export async function registerDeviceForPushNotifications(
  operatorCode: string | null,
): Promise<boolean> {
  if (!operatorCode?.trim() || (Platform.OS !== 'ios' && Platform.OS !== 'android')) {
    return false;
  }

  const permissionGranted = await requestNotificationPermission();
  if (!permissionGranted) {
    throw new Error(
      'Permite las notificaciones en los ajustes del dispositivo para recibir avisos de novedades y tareas.',
    );
  }

  const pushToken = await getExpoPushToken();
  if (!pushToken) return false;
  await tokenStorage.savePushToken(pushToken);

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
