import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export { diffCallStates, type CallStateNotice } from './call-diff';

const CHANNEL_ID = 'percaya-calls';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** Requests Android 13+ POST_NOTIFICATIONS permission and creates the calls channel. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Call status',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 120, 80, 120],
      });
    }
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const asked = await Notifications.requestPermissionsAsync();
    return asked.granted;
  } catch {
    return false;
  }
}

export async function notifyNow(title: string, body: string, callId: number): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data: { callId } },
      trigger: Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null,
    });
  } catch {
    // Notifications are best-effort; never block the UI
  }
}
