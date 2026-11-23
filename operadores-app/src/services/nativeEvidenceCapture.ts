import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import type { TaskEvidenceAsset } from '../types/tarea';

export async function captureNativeEvidence(
  mode: 'photo' | 'video',
  maxVideoDurationSeconds: number,
  onVideoCameraOpening?: () => void,
): Promise<TaskEvidenceAsset | null> {
  const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
  if (!cameraPermission.granted) {
    throw new Error('Debes permitir el acceso a la cámara para tomar evidencias.');
  }
  if (mode === 'video') {
    const microphonePermission = await Camera.requestMicrophonePermissionsAsync();
    if (!microphonePermission.granted) {
      throw new Error('Debes permitir el micrófono para grabar videos.');
    }
  }
  const locationPermission = await Location.requestForegroundPermissionsAsync();
  if (!locationPermission.granted) {
    throw new Error('Debes permitir la ubicación para agregar cada evidencia. Revisa los permisos del dispositivo.');
  }

  if (mode === 'video') onVideoCameraOpening?.();
  const result = await ImagePicker.launchCameraAsync(mode === 'photo'
    ? { mediaTypes: ['images'], quality: 0.9, exif: true }
    : { mediaTypes: ['videos'], videoMaxDuration: maxVideoDurationSeconds });
  if (result.canceled) return null;

  const asset = result.assets[0];
  if (!asset) throw new Error('La cámara no devolvió una evidencia.');
  const capturedAt = new Date().toISOString();
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  if (!Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 30000) {
    throw new Error('La ubicación no está actualizada. Activa el GPS e inténtalo nuevamente.');
  }
  if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)
      || Math.abs(position.coords.latitude) > 90 || Math.abs(position.coords.longitude) > 180) {
    throw new Error('La ubicación obtenida no es válida. Inténtalo nuevamente.');
  }

  const mimeType = asset.mimeType ?? (mode === 'photo'
    ? 'image/jpeg'
    : Platform.OS === 'ios' ? 'video/quicktime' : 'video/mp4');
  const extension = mode === 'photo'
    ? mimeType === 'image/heic' || mimeType === 'image/heif' ? 'heic' : 'jpg'
    : mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const name = mode === 'video' && !asset.fileName?.toLowerCase().endsWith(`.${extension}`)
    ? `video-${Date.now()}.${extension}`
    : asset.fileName ?? `foto-${Date.now()}.${extension}`;

  return {
    uri: asset.uri,
    name,
    mimeType,
    size: asset.fileSize,
    durationMs: mode === 'video' ? asset.duration ?? undefined : undefined,
    capturedAt,
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}
