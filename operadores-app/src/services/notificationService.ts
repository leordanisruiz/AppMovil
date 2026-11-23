import { Platform } from 'react-native';
import Constants from 'expo-constants';

export type TaskNotificationDestination = 'asignadas' | 'creadas';

export function areNativeNotificationsAvailable(): boolean {
  const isExpoGo =
    Constants.appOwnership === 'expo' ||
    (Constants.executionEnvironment === 'storeClient' &&
      typeof Constants.expoVersion === 'string');

  // Remote push is unavailable in Expo Go on Android; keep this check free of
  // native Expo Go module calls so it also works in standalone APKs.
  return !(Platform.OS === 'android' && isExpoGo);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || !areNativeNotificationsAvailable()) return false;

  const notifications = await import('./notificationService.native');
  return notifications.requestNotificationPermission();
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !areNativeNotificationsAvailable()) return null;

  const notifications = await import('./notificationService.native');
  return notifications.getExpoPushToken();
}

export async function syncAppBadge(pendingCount: number): Promise<void> {
  if (Platform.OS === 'web' || !areNativeNotificationsAvailable()) return;

  const notifications = await import('./notificationService.native');
  await notifications.syncAppBadge(pendingCount);
}

export function subscribeToNoveltyNavigation(
  onOpenNovedades: () => void,
  onNotificationReceived: () => void,
  onOpenTasks: (destination: TaskNotificationDestination) => void,
): () => void {
  if (Platform.OS === 'web' || !areNativeNotificationsAvailable()) return () => {};

  let isActive = true;
  let unsubscribe: (() => void) | undefined;

  void import('./notificationService.native')
    .then((notifications) => {
      if (isActive) {
        unsubscribe = notifications.subscribeToNoveltyNavigation(
          onOpenNovedades,
          onNotificationReceived,
          onOpenTasks,
        );
      }
    })
    .catch((error: unknown) => {
      console.error('No se pudo inicializar la navegación de notificaciones:', error);
    });

  return () => {
    isActive = false;
    unsubscribe?.();
  };
}
