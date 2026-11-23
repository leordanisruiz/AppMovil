import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import Constants from 'expo-constants';
import type { TaskNotificationDestination } from './notificationService';

export const NOVELTY_CHANNEL_ID = 'novedades';
export const TASK_CHANNEL_ID = 'tareas';

export function areNativeNotificationsAvailable(): boolean {
  const isExpoGo =
    Constants.appOwnership === 'expo' ||
    (Constants.executionEnvironment === 'storeClient' &&
      typeof Constants.expoVersion === 'string');

  // Android Expo Go cannot register remote push tokens; standalone and
  // development builds have the native modules required by this service.
  return !(Platform.OS === 'android' && isExpoGo);
}

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
          showBadge: true,
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

  if (typeof Notifications.setBadgeCountAsync !== 'function') {
    throw new Error('El dispositivo no permite actualizar el contador de la aplicación.');
  }
  const updated = await Notifications.setBadgeCountAsync(Math.max(0, pendingCount));
  if (!updated) {
    throw new Error('El lanzador no admite actualizar el contador de la aplicación.');
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
  onOpenTasks: (destination: TaskNotificationDestination) => void,
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
    onOpenTasks(taskNotificationDestination(lastData));
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
        onOpenTasks(taskNotificationDestination(response.notification.request.content.data));
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

function taskNotificationDestination(data: unknown): TaskNotificationDestination {
  if (
    typeof data === 'object' &&
    data !== null &&
    'evento' in data &&
    data.evento === 'cambio_estado' &&
    'estado' in data &&
    data.estado === 'COMPLETADA'
  ) {
    return 'creadas';
  }
  return 'asignadas';
}
