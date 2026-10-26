import { Platform } from 'react-native';
import { isRunningInExpoGo } from 'expo';

export function areNativeNotificationsAvailable(): boolean {
  // expo-notifications 58.1.6 can crash on import in Expo Go for Android
  // because Expo Go does not register ExpoTopicSubscriptionModule.
  return !(Platform.OS === 'android' && isRunningInExpoGo());
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

export async function showNewNoveltyNotification(
  newNoveltyCount: number,
): Promise<void> {
  if (
    Platform.OS === 'web' ||
    !areNativeNotificationsAvailable() ||
    newNoveltyCount < 1
  ) return;

  const notifications = await import('./notificationService.native');
  await notifications.showNewNoveltyNotification(newNoveltyCount);
}

export async function syncAppBadge(pendingCount: number): Promise<void> {
  if (Platform.OS === 'web' || !areNativeNotificationsAvailable()) return;

  const notifications = await import('./notificationService.native');
  await notifications.syncAppBadge(pendingCount);
}

export function subscribeToNoveltyNavigation(
  onOpenNovedades: () => void,
  onNotificationReceived: () => void,
  onOpenTasks: () => void,
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
