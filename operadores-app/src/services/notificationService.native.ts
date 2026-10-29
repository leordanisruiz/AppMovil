import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import Constants from 'expo-constants';

export const NOVELTY_CHANNEL_ID = 'novedades';
export const TASK_CHANNEL_ID = 'tareas';

type AndroidChannel = {
  id: string;
  name: string;
  importance: AndroidImportance;
  vibrationPattern: number[];
  lightColor: string;
};

const ANDROID_CHANNELS: AndroidChannel[] = [
  {
    id: NOVELTY_CHANNEL_ID,
    name: 'Novedades',
    importance: AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF0000',
  },
  {
    id: TASK_CHANNEL_ID,
    name: 'Tareas asignadas',
    importance: AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF0000',
  },
];

if (typeof Notifications.setNotificationHandler === 'function') {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const data = notification.request.content.data;
      const isForegroundFallback =
        data?.source === 'foreground-poll' ||
        data?.tipo === 'tarea' ||
        data?.tipo === 'novedad';
      const shouldPresent =
        AppState.currentState !== 'active' || isForegroundFallback;

      return {
        shouldPlaySound: shouldPresent,
        shouldSetBadge: true,
        shouldShowBanner: shouldPresent,
        shouldShowList: shouldPresent,
      };
    },
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    if (typeof Notifications.setNotificationChannelAsync !== 'function') return false;
    await Promise.all(
      ANDROID_CHANNELS.map((channel) =>
        Notifications.setNotificationChannelAsync(channel.id, {
          name: channel.name,
          importance: channel.importance,
          vibrationPattern: channel.vibrationPattern,
          lightColor: channel.lightColor,
        }),
      ),
    );
  }

  if (typeof Notifications.getPermissionsAsync !== 'function') return false;
  const currentPermissions = await Notifications.getPermissionsAsync();
  if (currentPermissions.granted) {
    return true;
  }

  if (typeof Notifications.requestPermissionsAsync !== 'function') return false;
  const requestedPermissions = await Notifications.requestPermissionsAsync();
  return requestedPermissions.granted;
}

export async function syncAppBadge(pendingCount: number): Promise<void> {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return;

  if (typeof Notifications.setBadgeCountAsync === 'function') {
    await Notifications.setBadgeCountAsync(Math.max(0, pendingCount));
  }
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

  if (typeof Notifications.getExpoPushTokenAsync !== 'function') return null;

  const pushToken = await Notifications.getExpoPushTokenAsync({ projectId });
  return pushToken.data;
}

export function subscribeToNoveltyNavigation(
  onOpenNovedades: () => void,
  onNotificationReceived: () => void,
  onOpenTasks: () => void,
): () => void {
  const lastResponse = typeof Notifications.getLastNotificationResponse === 'function'
    ? Notifications.getLastNotificationResponse()
    : null;
  const lastData = lastResponse?.notification.request.content.data;
  if (isNoveltyNotification(lastData)) {
    onNotificationReceived();
    onOpenNovedades();
    if (typeof Notifications.clearLastNotificationResponse === 'function') {
      Notifications.clearLastNotificationResponse();
    }
  } else if (isTaskNotification(lastData)) {
    onNotificationReceived();
    onOpenTasks();
    if (typeof Notifications.clearLastNotificationResponse === 'function') {
      Notifications.clearLastNotificationResponse();
    }
  }

  if (
    typeof Notifications.addNotificationReceivedListener !== 'function' ||
    typeof Notifications.addNotificationResponseReceivedListener !== 'function'
  ) return () => {};

  const receivedListener = Notifications.addNotificationReceivedListener(() => {
    onNotificationReceived();
  });
  const responseListener =
    Notifications.addNotificationResponseReceivedListener((response) => {
      if (isNoveltyNotification(response.notification.request.content.data)) {
        onNotificationReceived();
        onOpenNovedades();
        if (typeof Notifications.clearLastNotificationResponse === 'function') {
          Notifications.clearLastNotificationResponse();
        }
      } else if (isTaskNotification(response.notification.request.content.data)) {
        onNotificationReceived();
        onOpenTasks();
        if (typeof Notifications.clearLastNotificationResponse === 'function') {
          Notifications.clearLastNotificationResponse();
        }
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

function isTaskNotification(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'tipo' in data &&
    data.tipo === 'tarea'
  );
}
