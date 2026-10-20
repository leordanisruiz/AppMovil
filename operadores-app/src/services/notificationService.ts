import { Platform } from 'react-native';
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const notifications = await import('./notificationService.native');
  return notifications.requestNotificationPermission();
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  const notifications = await import('./notificationService.native');
  return notifications.getExpoPushToken();
}

export async function showNewNoveltyNotification(
  newNoveltyCount: number,
): Promise<void> {
  if (Platform.OS === 'web' || newNoveltyCount < 1) return;

  const notifications = await import('./notificationService.native');
  await notifications.showNewNoveltyNotification(newNoveltyCount);
}

export function subscribeToNoveltyNavigation(
  onOpenNovedades: () => void,
  onNotificationReceived: () => void,
): () => void {
  if (Platform.OS === 'web') return () => {};

  let isActive = true;
  let unsubscribe: (() => void) | undefined;

  void import('./notificationService.native')
    .then((notifications) => {
      if (isActive) {
        unsubscribe = notifications.subscribeToNoveltyNavigation(
          onOpenNovedades,
          onNotificationReceived,
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
