import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const isForegroundFallback =
      notification.request.content.data?.source === 'foreground-poll';
    const shouldPresent =
      AppState.currentState !== 'active' || isForegroundFallback;

    return {
      shouldPlaySound: shouldPresent,
      shouldSetBadge: false,
      shouldShowBanner: shouldPresent,
      shouldShowList: shouldPresent,
    };
  },
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('novedades', {
      name: 'Novedades',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF0000',
    });
  }

  const currentPermissions = await Notifications.getPermissionsAsync();
  if (currentPermissions.granted) {
    return true;
  }

  const requestedPermissions = await Notifications.requestPermissionsAsync();
  return requestedPermissions.granted;
}

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;

  const projectId =
    Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) {
    throw new Error(
      'Falta el EAS projectId. Configura el proyecto con eas init y vuelve a generar la app.',
    );
  }

  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  return pushToken.data;
}

export async function showNewNoveltyNotification(
  newNoveltyCount: number,
): Promise<void> {
  if (newNoveltyCount < 1) return;

  const noun = newNoveltyCount === 1 ? 'novedad nueva' : 'novedades nuevas';
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Nuevas novedades',
      body: `Tienes ${newNoveltyCount} ${noun}. Por favor revisa para que realices el trámite de cierre.`,
      data: { source: 'foreground-poll' },
    },
    trigger: null,
  });
}

export function subscribeToNoveltyNavigation(
  onOpenNovedades: () => void,
  onNotificationReceived: () => void,
): () => void {
  const lastResponse = Notifications.getLastNotificationResponse();
  const lastData = lastResponse?.notification.request.content.data;
  if (isNoveltyNotification(lastData)) {
    onOpenNovedades();
    Notifications.clearLastNotificationResponse();
  }

  const receivedListener = Notifications.addNotificationReceivedListener(() => {
    onNotificationReceived();
  });
  const responseListener =
    Notifications.addNotificationResponseReceivedListener((response) => {
      if (isNoveltyNotification(response.notification.request.content.data)) {
        onOpenNovedades();
        Notifications.clearLastNotificationResponse();
      }
    });

  return () => {
    receivedListener.remove();
    responseListener.remove();
  };
}

function isNoveltyNotification(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'tipo' in data &&
    data.tipo === 'novedad'
  );
}
