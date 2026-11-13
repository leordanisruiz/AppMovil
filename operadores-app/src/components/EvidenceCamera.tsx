import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType, type FlashMode } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { TaskEvidenceAsset } from '../types/tarea';

type CaptureMode = 'photo' | 'video';

const MAX_VIDEO_SECONDS = 180;

export function EvidenceCamera({
  mode, onClose, onCapture,
}: {
  mode: CaptureMode;
  onClose: () => void;
  onCapture: (asset: TaskEvidenceAsset) => void;
}) {
  const camera = useRef<CameraView>(null);
  const webVideo = useRef<HTMLVideoElement | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const active = useRef(false);
  const capturing = useRef(false);
  const stopping = useRef(false);
  const nativeRecordingReady = useRef(false);
  const lastWebFacing = useRef<CameraType>('back');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [, requestMicrophonePermission] = useMicrophonePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [torch, setTorch] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let open = true;
    active.current = true;
    const requestPermission = async () => {
      if (Platform.OS === 'web') return;
      try {
        const permission = await requestCameraPermission();
        if (!permission.granted && open) {
          setError('Debes permitir el acceso a la cámara para tomar evidencias.');
        }
      } catch (cause) {
        if (open) setError(cause instanceof Error ? cause.message : 'No fue posible abrir la cámara.');
      }
    };
    void requestPermission();
    return () => {
      open = false;
      active.current = false;
      if (recorder.current?.state === 'recording') recorder.current.stop();
    };
  }, [requestCameraPermission]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let open = true;
    let stream: MediaStream | null = null;
    const openCamera = async () => {
      setReady(false);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('La cámara requiere HTTPS o localhost y un navegador compatible.');
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing === 'front'
              ? { exact: 'user' }
              : facing === lastWebFacing.current ? 'environment' : { exact: 'environment' },
          },
        });
        if (!open) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!webVideo.current) throw new Error('No fue posible mostrar la cámara.');
        webVideo.current.srcObject = stream;
        await webVideo.current.play();
        if (open) {
          lastWebFacing.current = facing;
          setReady(true);
        }
      } catch (cause) {
        stream?.getTracks().forEach((track) => track.stop());
        if (open) {
          if (facing !== lastWebFacing.current) {
            setError('No fue posible cambiar de cámara. Comprueba que el dispositivo tenga la cámara solicitada.');
            setFacing(lastWebFacing.current);
          } else {
            setError(cause instanceof Error ? cause.message : 'No fue posible abrir la cámara.');
          }
        }
      }
    };
    void openCamera();
    return () => {
      open = false;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [facing]);

  const switchCamera = () => {
    setError(null);
    setReady(false);
    setFlash('off');
    setTorch(false);
    setZoom(0);
    setFacing((current) => current === 'back' ? 'front' : 'back');
  };

  const stopRecording = () => {
    if (stopping.current) return;
    stopping.current = true;
    setIsStopping(true);
    if (Platform.OS === 'web') {
      if (recorder.current?.state === 'recording') recorder.current.stop();
    } else if (nativeRecordingReady.current) {
      camera.current?.stopRecording();
    }
  };

  const capture = async () => {
    if (!ready || capturing.current) return;
    capturing.current = true;
    setBusy(true);
    setError(null);
    setElapsedSeconds(0);
    stopping.current = false;
    nativeRecordingReady.current = false;
    setIsStopping(false);
    let audio: MediaStream | null = null;
    try {
      // On native platforms, use the system camera UI so the person can review,
      // retake, or cancel the photo before it is attached to the task.
      if (mode === 'photo' && Platform.OS !== 'web') {
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!active.current) return;
        if (!cameraPermission.granted) {
          throw new Error('Debes permitir el acceso a la cámara para tomar evidencias.');
        }

        const locationPermission = await Location.requestForegroundPermissionsAsync();
        if (!active.current) return;
        if (!locationPermission.granted) {
          throw new Error('Debes permitir la ubicación para agregar cada evidencia. Revisa los permisos del dispositivo.');
        }

        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.9,
          exif: true,
          cameraType: facing === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        });
        if (!active.current || result.canceled) return;

        const picture = result.assets[0];
        const capturedAt = new Date().toISOString();
        const position = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No fue posible obtener la ubicación. Activa el GPS e inténtalo nuevamente.')), 20000)),
        ]);
        if (!active.current) return;
        if (!Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 30000) {
          throw new Error('La ubicación no está actualizada. Activa el GPS e inténtalo nuevamente.');
        }
        if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)
            || Math.abs(position.coords.latitude) > 90 || Math.abs(position.coords.longitude) > 180) {
          throw new Error('La ubicación obtenida no es válida. Inténtalo nuevamente.');
        }

        const mimeType = picture.mimeType ?? 'image/jpeg';
        const extension = mimeType === 'image/heic' || mimeType === 'image/heif' ? 'heic' : 'jpg';
        onCapture({
          uri: picture.uri,
          name: picture.fileName ?? `foto-${Date.now()}.${extension}`,
          mimeType,
          size: picture.fileSize,
          capturedAt,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        return;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (!active.current) return;
      if (!permission.granted) {
        throw new Error('Debes permitir la ubicación para agregar cada evidencia. Revisa los permisos del dispositivo.');
      }
      if (mode === 'video' && Platform.OS !== 'web') {
        const microphone = await requestMicrophonePermission();
        if (!active.current) return;
        if (!microphone.granted) throw new Error('Debes permitir el micrófono para grabar videos.');
      }
      if (mode === 'video' && Platform.OS === 'web') {
        if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported('video/mp4')) {
          throw new Error('Este navegador no permite grabar video MP4. Usa la aplicación móvil u otro navegador compatible.');
        }
        audio = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (!active.current) return;
      }
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No fue posible obtener la ubicación. Activa el GPS e inténtalo nuevamente.')), 20000)),
      ]);
      if (!active.current) return;
      if (!Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 30000) {
        throw new Error('La ubicación no está actualizada. Activa el GPS e inténtalo nuevamente.');
      }
      if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)
          || Math.abs(position.coords.latitude) > 90 || Math.abs(position.coords.longitude) > 180) {
        throw new Error('La ubicación obtenida no es válida. Inténtalo nuevamente.');
      }
      const capturedAt = new Date().toISOString();
      const location = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      if (mode === 'photo') {
        if (Platform.OS === 'web') {
          const video = webVideo.current;
          if (!video || !video.videoWidth || !video.videoHeight) throw new Error('La cámara aún no está lista.');
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('No fue posible capturar la imagen.');
          context.drawImage(video, 0, 0);
          const blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No fue posible guardar la imagen.')), 'image/jpeg', 0.9),
          );
          if (!active.current) return;
          onCapture({ uri: URL.createObjectURL(blob), webFile: blob, name: `foto-${Date.now()}.jpg`, mimeType: 'image/jpeg', size: blob.size, capturedAt, ...location });
        }
      } else if (Platform.OS === 'web') {
        const videoStream = webVideo.current?.srcObject;
        if (!(videoStream instanceof MediaStream)) throw new Error('La cámara aún no está lista.');
        const combined = new MediaStream([...videoStream.getVideoTracks(), ...audio!.getAudioTracks()]);
        const mediaRecorder = new MediaRecorder(combined, { mimeType: 'video/mp4' });
        recorder.current = mediaRecorder;
        const chunks: Blob[] = [];
        mediaRecorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        const result = new Promise<Blob>((resolve, reject) => {
          mediaRecorder.onstop = () => resolve(new Blob(chunks, { type: 'video/mp4' }));
          mediaRecorder.onerror = () => reject(new Error('No fue posible grabar el video.'));
        });
        mediaRecorder.start();
        const startedAt = performance.now();
        setRecording(true);
        const progressTimer = setInterval(() => {
          if (active.current && mediaRecorder.state === 'recording') {
            setElapsedSeconds(Math.floor((performance.now() - startedAt) / 1000));
          }
        }, 250);
        const limitTimer = setTimeout(() => {
          if (mediaRecorder.state === 'recording') stopRecording();
        }, MAX_VIDEO_SECONDS * 1000);
        try {
          const blob = await result;
          if (!active.current) return;
          if (!blob.size) throw new Error('El video grabado está vacío.');
          onCapture({ uri: URL.createObjectURL(blob), webFile: blob, name: `video-${Date.now()}.mp4`, mimeType: 'video/mp4', size: blob.size, capturedAt, ...location });
        } finally {
          clearInterval(progressTimer);
          clearTimeout(limitTimer);
          recorder.current = null;
        }
      } else {
        if (!camera.current) throw new Error('La cámara aún no está lista.');
        setRecording(true);
        const video = await camera.current.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
        if (!active.current) return;
        if (!video) throw new Error('No fue posible grabar el video.');
        const isMov = Platform.OS === 'ios';
        onCapture({ uri: video.uri, name: `video-${Date.now()}.${isMov ? 'mov' : 'mp4'}`, mimeType: isMov ? 'video/quicktime' : 'video/mp4', capturedAt, ...location });
      }
    } catch (cause) {
      if (active.current) setError(cause instanceof Error ? cause.message : 'No fue posible capturar la evidencia.');
    } finally {
      audio?.getTracks().forEach((track) => track.stop());
      capturing.current = false;
      if (active.current) {
        setRecording(false);
        setIsStopping(false);
        setBusy(false);
      }
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <SafeAreaView edges={['top', 'bottom']} style={styles.container}>
        {Platform.OS === 'web'
          ? <video ref={webVideo} muted playsInline style={{ width: '100%', flex: 1, objectFit: 'contain' }} />
          : cameraPermission?.granted ? <CameraView key={facing} ref={camera} mode={mode === 'video' ? 'video' : 'picture'} style={styles.preview}
              facing={facing} flash={flash} enableTorch={torch} zoom={zoom}
              onCameraReady={() => setReady(true)}
              onMountError={(event) => { setReady(false); setError(event.message); }}
              onRecordingProgress={({ duration }) => {
                if (capturing.current) {
                  if (!nativeRecordingReady.current) {
                    nativeRecordingReady.current = true;
                    if (stopping.current) camera.current?.stopRecording();
                  }
                  if (!stopping.current && Number.isFinite(duration)) {
                    setElapsedSeconds(Math.max(0, Math.floor(duration)));
                  }
                }
              }} /> : null}
        {recording && !isStopping ? (
          <View style={styles.recordingIndicator}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>
              Grabando {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')} / 03:00
            </Text>
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            disabled={busy || (!ready && !error)}
            onPress={switchCamera}
            style={[styles.controlButton, (busy || (!ready && !error)) && styles.disabled]}
          >
            <Text style={styles.text}>Cambiar cámara</Text>
          </Pressable>
          {Platform.OS !== 'web' && facing === 'back' ? (
            <Pressable
              accessibilityRole="button"
              disabled={!ready || (busy && (!recording || mode === 'photo' || isStopping))}
              onPress={() => {
                if (mode === 'video') setTorch((current) => !current);
                else setFlash((current) => current === 'off' ? 'on' : current === 'on' ? 'auto' : 'off');
              }}
              style={[styles.controlButton, (!ready || (busy && (!recording || mode === 'photo' || isStopping))) && styles.disabled]}
            >
              <Text style={styles.text}>
                {mode === 'video' ? `Linterna: ${torch ? 'sí' : 'no'}` : `Flash: ${flash === 'off' ? 'no' : flash === 'on' ? 'sí' : 'auto'}`}
              </Text>
            </Pressable>
          ) : null}
          {Platform.OS !== 'web' ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel="Alejar zoom"
                disabled={!ready || zoom === 0 || (busy && (!recording || isStopping))}
                onPress={() => setZoom((current) => Math.max(0, Math.round((current - 0.1) * 10) / 10))}
                style={[styles.controlButton, (!ready || zoom === 0 || (busy && (!recording || isStopping))) && styles.disabled]}>
                <Text style={styles.text}>−</Text>
              </Pressable>
              <Text style={styles.zoomText}>Zoom {Math.round(zoom * 100)}%</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Acercar zoom"
                disabled={!ready || zoom === 1 || (busy && (!recording || isStopping))}
                onPress={() => setZoom((current) => Math.min(1, Math.round((current + 0.1) * 10) / 10))}
                style={[styles.controlButton, (!ready || zoom === 1 || (busy && (!recording || isStopping))) && styles.disabled]}>
                <Text style={styles.text}>+</Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <Text style={styles.hint}>La ubicación es obligatoria para cada evidencia.</Text>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={[styles.button, busy && styles.disabled]}><Text style={styles.text}>Cancelar</Text></Pressable>
          {recording ? (
            <Pressable accessibilityRole="button" disabled={isStopping} onPress={stopRecording} style={[styles.button, isStopping && styles.disabled]}>
              <Text style={styles.text}>{isStopping ? 'Guardando video...' : 'Detener grabación'}</Text>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" disabled={!ready || busy} onPress={() => void capture()} style={[styles.button, (!ready || busy) && styles.disabled]}>
              {busy ? <ActivityIndicator color="white" /> : <Text style={styles.text}>{mode === 'photo' ? 'Tomar foto' : 'Grabar video'}</Text>}
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#171717' },
  preview: { flex: 1 },
  recordingIndicator: { alignItems: 'center', alignSelf: 'center', backgroundColor: '#252525', borderRadius: 16, flexDirection: 'row', gap: 8, marginTop: 8, paddingHorizontal: 14, paddingVertical: 8 },
  recordingDot: { backgroundColor: '#e12626', borderRadius: 5, height: 10, width: 10 },
  recordingText: { color: '#fff', fontWeight: '700' },
  error: { color: '#fff', backgroundColor: '#8b2e00', padding: 12 },
  controls: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', paddingHorizontal: 12, paddingTop: 12 },
  controlButton: { backgroundColor: '#444', borderRadius: 8, minHeight: 40, justifyContent: 'center', paddingHorizontal: 12 },
  zoomText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.45 },
  hint: { color: '#fff', paddingHorizontal: 12, paddingTop: 10, textAlign: 'center' },
  actions: { flexDirection: 'row', justifyContent: 'space-around', padding: 12 },
  button: { backgroundColor: '#d90000', borderRadius: 10, padding: 14, minWidth: 120, alignItems: 'center' },
  text: { color: '#fff', fontWeight: '700' },
});
