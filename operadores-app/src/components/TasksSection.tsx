import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  Alert,
  Easing,
  Image,
  Modal,
  PanResponder,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../services/authService';
import { tareasService } from '../services/tareasService';
import { colors, radius, spacing, typography } from '../theme';
import type {
  OperatorTask,
  TaskEvidenceAsset,
  TaskStatus,
} from '../types/tarea';
import { useTareas } from '../hooks/useTareas';
import { useAuth } from '../store/AuthProvider';
import { AppButton } from './AppButton';
import { EvidenceGallery } from './EvidenceGallery';
import { SectionHeading } from './SectionHeading';
import { DesktopTasksTable, type TaskStatusFilter } from './DesktopTasksTable';

type TasksSectionProps = {
  operatorCode: string | null;
  initialStatusFilter?: TaskStatusFilter;
};

const MAX_PHOTOS_PER_TASK = 12;
const MAX_VIDEOS_PER_TASK = 2;
const MAX_SELECTED_FILES = MAX_PHOTOS_PER_TASK + MAX_VIDEOS_PER_TASK;
const MAX_SELECTED_SIZE = 100 * 1024 * 1024;
const MAX_VIDEO_DURATION_MS = 3 * 60 * 1000;
const SUPPORTED_EVIDENCE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
]);

export function TasksSection({ operatorCode, initialStatusFilter = 'TODAS' }: TasksSectionProps) {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 1200;
  const queryClient = useQueryClient();
  const { operator } = useAuth();
  const canManageEvidence = operator?.rolId === 1 || operator?.rolId === 2;
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const detailBackSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          selectedTaskId !== null &&
          gesture.x0 <= 64 &&
          gesture.dx >= 36 &&
          Math.abs(gesture.dy) < 55,
        onPanResponderRelease: (_event, gesture) => {
          if (selectedTaskId === null || gesture.dx < 92) return;
          setSelectedTaskId(null);
          setSelectedAssets([]);
          setActionError(null);
          setActionSuccess(null);
        },
      }),
    [selectedTaskId],
  );
  const [selectedAssets, setSelectedAssets] = useState<TaskEvidenceAsset[]>([]);
  const selectedAssetsRef = useRef<TaskEvidenceAsset[]>([]);
  useEffect(() => { selectedAssetsRef.current = selectedAssets; }, [selectedAssets]);
  useEffect(() => () => selectedAssetsRef.current.forEach(releaseWebAsset), []);
  const [isSourcePickerVisible, setIsSourcePickerVisible] = useState(false);
  const [isCompletionConfirmVisible, setIsCompletionConfirmVisible] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [completedTask, setCompletedTask] = useState<OperatorTask | null>(null);
  const pendingPickerAction = useRef<(() => Promise<void>) | null>(null);
  const pickerInProgress = useRef(false);
  const tasksQuery = useTareas(Boolean(operatorCode));
  const detailQuery = useQuery({
    queryKey: ['tarea', selectedTaskId],
    queryFn: () => tareasService.getById(selectedTaskId!),
    enabled: selectedTaskId !== null,
    staleTime: 0,
  });

  const uploadMutation = useMutation({
    mutationFn: () => {
      if (selectedTaskId === null) {
        throw new Error('Selecciona una tarea antes de subir evidencias.');
      }
      return tareasService.uploadEvidence(selectedTaskId, selectedAssets);
    },
    onSuccess: async ({ tarea, evidencias_agregadas }) => {
      queryClient.setQueryData(['tarea', tarea.id], tarea);
      await queryClient.invalidateQueries({ queryKey: ['tareas'] });
      selectedAssets.forEach(releaseWebAsset);
      setSelectedAssets([]);
      setActionError(null);
      setActionSuccess(
        `${evidencias_agregadas} evidencia${evidencias_agregadas === 1 ? '' : 's'} subida${evidencias_agregadas === 1 ? '' : 's'}. La tarea está en proceso.`,
      );
    },
    onError: (error: unknown) => {
      setActionError(
        getApiErrorMessage(error, 'No fue posible subir las evidencias. Inténtalo nuevamente.'),
      );
    },
  });

  const statusMutation = useMutation({
    mutationFn: (estado: TaskStatus) => {
      if (selectedTaskId === null) {
        throw new Error('Selecciona una tarea antes de actualizar su estado.');
      }
      return tareasService.updateStatus(selectedTaskId, estado);
    },
    onSuccess: async (task) => {
      queryClient.setQueryData(['tarea', task.id], task);
      await queryClient.invalidateQueries({ queryKey: ['tareas'] });
      setActionError(null);
      setActionSuccess(null);
      if (task.estado === 'COMPLETADA') setCompletedTask(task);
    },
    onError: (error: unknown) => {
      setActionError(
        getApiErrorMessage(error, 'No fue posible actualizar el estado de la tarea.'),
      );
    },
  });

  const addAssets = (assets: TaskEvidenceAsset[]): boolean => {
    setActionError(null);
    setActionSuccess(null);
    if (assets.some((asset) => !SUPPORTED_EVIDENCE_TYPES.has(asset.mimeType))) {
      Alert.alert(
        'Formato no compatible',
        'El servidor admite imágenes JPG, PNG, WEBP, HEIC o HEIF y videos MP4 o MOV.',
      );
      return false;
    }
    const additions = assets
      .filter((asset) => !selectedAssets.some((selected) => selected.uri === asset.uri));
    const existingEvidence = detailQuery.data?.evidencias ?? [];
    const photoCount = existingEvidence.filter((item) => item.tipo === 'image').length
      + selectedAssets.filter((item) => item.mimeType.startsWith('image/')).length;
    const videoCount = existingEvidence.filter((item) => item.tipo === 'video').length
      + selectedAssets.filter((item) => item.mimeType.startsWith('video/')).length;
    const addedPhotos = additions.filter((item) => item.mimeType.startsWith('image/')).length;
    const addedVideos = additions.filter((item) => item.mimeType.startsWith('video/')).length;
    if (photoCount + addedPhotos > MAX_PHOTOS_PER_TASK) {
      Alert.alert('Límite de fotografías', 'Solo se permiten máximo 12 fotografías por tarea.');
      return false;
    }
    if (videoCount + addedVideos > MAX_VIDEOS_PER_TASK) {
      Alert.alert('Límite de videos', 'Solo se permiten máximo 2 videos por tarea.');
      return false;
    }
    if (selectedAssets.length + additions.length > MAX_SELECTED_FILES) {
      Alert.alert(
        'Límite de archivos',
        `Puedes adjuntar hasta ${MAX_SELECTED_FILES} archivos por envío.`,
      );
      return false;
    }
    const videosOverLimit = additions.filter(
      (asset) =>
        asset.mimeType.startsWith('video/')
        && typeof asset.durationMs === 'number'
        && asset.durationMs > MAX_VIDEO_DURATION_MS,
    );
    if (videosOverLimit.length > 0) {
      Alert.alert(
        'Video demasiado largo',
        'Solo se permiten videos de hasta 3 minutos. Graba o selecciona un video más corto.',
      );
      return false;
    }
    const totalSize = [...selectedAssets, ...additions].reduce(
      (total, asset) => total + (asset.size ?? 0),
      0,
    );
    if (totalSize > MAX_SELECTED_SIZE) {
      Alert.alert('Archivos muy pesados', 'El tamaño total no puede superar 100 MB.');
      return false;
    }
    setSelectedAssets([...selectedAssets, ...additions]);
    return true;
  };

  const handleDroppedFiles = (files: File[]) => {
    if (Platform.OS !== 'web') return;
    const assets = files.map((file): TaskEvidenceAsset => ({
      uri: URL.createObjectURL(file),
      name: file.name || `evidencia-${Date.now()}`,
      mimeType: file.type || inferEvidenceMimeType(file.name),
      size: file.size,
      webFile: file,
    }));
    if (!addAssets(assets)) assets.forEach(releaseWebAsset);
  };

  const showPickerError = (error: unknown) => {
    console.error('No fue posible seleccionar una evidencia:', error);
    const errorText = error instanceof Error ? error.message : String(error);
    if (errorText.includes('PickingInProgressException')) {
      setActionError(
        'El selector de archivos aún está abierto. Ciérralo e intenta seleccionar el archivo nuevamente.',
      );
      return;
    }
    setActionError(
      getApiErrorMessage(error, 'No fue posible abrir la cámara o la galería.'),
    );
  };

  const runPendingPickerAction = async () => {
    const action = pendingPickerAction.current;
    if (!action) return;
    pendingPickerAction.current = null;
    try {
      await action();
    } finally {
      pickerInProgress.current = false;
    }
  };

  const launchPickerAfterDismiss = (action: () => Promise<void>) => {
    if (pickerInProgress.current) return;
    pickerInProgress.current = true;
    pendingPickerAction.current = action;
    setIsSourcePickerVisible(false);
    setTimeout(() => void runPendingPickerAction(), 500);
  };

  const takePhoto = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permiso de cámara requerido',
          'Permite el acceso a la cámara para tomar una foto como evidencia.',
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        exif: true,
        quality: 0.8,
      });
      if (!result.canceled) addAssets(result.assets.map((asset) => toTaskEvidenceAsset(asset, true)));
    } catch (error) {
      showPickerError(error);
    }
  };

  const recordVideo = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso de cámara requerido', 'Permite el acceso a la cámara para grabar un video.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        videoMaxDuration: 120,
        quality: 0.7,
      });
      if (!result.canceled) addAssets(result.assets.map((asset) => toTaskEvidenceAsset(asset, true)));
    } catch (error) {
      showPickerError(error);
    }
  };

  const chooseGallery = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permiso de galería requerido',
          'Permite el acceso a fotos y videos para seleccionarlos. También puedes usar “Seleccionar Archivo”.',
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: true,
        selectionLimit: MAX_SELECTED_FILES,
        exif: true,
        quality: 0.8,
      });
      if (!result.canceled) addAssets(result.assets.map((asset) => toTaskEvidenceAsset(asset)));
    } catch (error) {
      showPickerError(error);
    }
  };

  const chooseFiles = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [...SUPPORTED_EVIDENCE_TYPES],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;

      const assets: TaskEvidenceAsset[] = [];
      for (const asset of result.assets) {
        const evidence = toTaskEvidenceAssetFromDocument(asset);
        if (!evidence) {
          Alert.alert(
            'Formato no compatible',
            'Selecciona únicamente archivos de imagen o video.',
          );
          return;
        }
        assets.push(evidence);
      }
      addAssets(assets);
    } catch (error) {
      showPickerError(error);
    }
  };

  const removeAsset = (uri: string) => {
    const removed = selectedAssets.find((asset) => asset.uri === uri);
    if (removed) releaseWebAsset(removed);
    setSelectedAssets((assets) => assets.filter((asset) => asset.uri !== uri));
  };

  useEffect(() => {
    if (selectedTaskId === null) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedTaskId(null);
      setSelectedAssets([]);
      setActionError(null);
      setActionSuccess(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedTaskId]);

  if (!operatorCode) {
    return (
      <View style={styles.noticeCard}>
        <Text style={styles.noticeTitle}>Tareas no disponibles</Text>
        <Text style={styles.bodyText}>
          Esta función está disponible para perfiles con código de operador.
        </Text>
      </View>
    );
  }

  if (selectedTaskId !== null) {
    const task = detailQuery.data;
    return (
      <View style={styles.section} {...detailBackSwipe.panHandlers}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSelectedTaskId(null);
            setSelectedAssets([]);
            setActionError(null);
            setActionSuccess(null);
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹  Volver a tareas</Text>
        </Pressable>
        {detailQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : detailQuery.isError || !task ? (
          <View style={styles.noticeCard}>
            <Text style={styles.bodyText}>No fue posible cargar el detalle de la tarea.</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void detailQuery.refetch()}
            >
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <TaskDetail
            task={task}
            selectedAssets={selectedAssets}
            isUploading={uploadMutation.isPending}
            isUpdatingStatus={statusMutation.isPending}
            actionError={actionError}
            actionSuccess={actionSuccess}
            canManageEvidence={canManageEvidence}
            onAttach={() => setIsSourcePickerVisible(true)}
            onRemoveAsset={removeAsset}
            onDropFiles={handleDroppedFiles}
            onUpload={() => uploadMutation.mutate()}
            onComplete={() => setIsCompletionConfirmVisible(true)}
          />
        )}
        <MediaSourcePicker
          visible={isSourcePickerVisible}
          onDismiss={() => void runPendingPickerAction()}
          onClose={() => setIsSourcePickerVisible(false)}
          onTakePhoto={() => launchPickerAfterDismiss(takePhoto)}
          onRecordVideo={() => launchPickerAfterDismiss(recordVideo)}
          onChooseGallery={() => launchPickerAfterDismiss(chooseGallery)}
          onChooseFiles={() => launchPickerAfterDismiss(chooseFiles)}
        />
        <TaskCompletionConfirmModal
          visible={isCompletionConfirmVisible}
          onCancel={() => setIsCompletionConfirmVisible(false)}
          onConfirm={() => {
            setIsCompletionConfirmVisible(false);
            statusMutation.mutate('COMPLETADA');
          }}
        />
        <TaskCompletionModal
          visible={completedTask !== null}
          onClose={() => setCompletedTask(null)}
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <SectionHeading
        title="Tareas asignadas"
        supportingText="Completa tus actividades y adjunta las evidencias solicitadas."
      />
      {tasksQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : tasksQuery.isError ? (
        <View style={styles.noticeCard}>
          <Text style={styles.bodyText}>No fue posible cargar tus tareas.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void tasksQuery.refetch()}
          >
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : tasksQuery.data?.length ? (
        desktop ? (
          <DesktopTasksTable
            tasks={tasksQuery.data}
            initialStatus={initialStatusFilter}
            onOpen={(task) => {
              setActionError(null);
              setActionSuccess(null);
              setSelectedAssets([]);
              setSelectedTaskId(task.id);
            }}
          />
        ) : <View style={styles.taskList}>
          {tasksQuery.data.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onPress={() => {
                setActionError(null);
                setActionSuccess(null);
                setSelectedAssets([]);
                setSelectedTaskId(task.id);
              }}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}>
            <Text style={styles.emptyIconText}>✓</Text>
          </View>
          <Text style={styles.noticeTitle}>No tienes tareas pendientes</Text>
          <Text style={styles.bodyText}>
            Cuando te asignen una tarea, aparecerá aquí.
          </Text>
        </View>
      )}
    </View>
  );
}

function TaskCard({
  task,
  onPress,
}: {
  task: OperatorTask;
  onPress: () => void;
}) {
  const status = getStatusPresentation(task.estado);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.taskCard, pressed && styles.taskCardPressed]}
    >
      <View style={styles.taskCardHeader}>
        <Text numberOfLines={2} style={styles.taskCardTitle}>
          {task.tipo_tarea}
        </Text>
        <TaskStatusBadge status={task.estado} />
      </View>
      <Text numberOfLines={2} style={styles.bodyText}>
        {task.descripcion}
      </Text>
      <View style={styles.taskCardFooter}>
        <Text style={styles.taskCardDate}>{formatDate(task.fecha_creacion)}</Text>
        <Text style={styles.taskCardEvidence}>
          {task.evidencias.length} evidencia{task.evidencias.length === 1 ? '' : 's'}
        </Text>
        <Text style={[styles.taskCardArrow, { color: status.color }]}>›</Text>
      </View>
    </Pressable>
  );
}

function TaskDetail({
  task,
  selectedAssets,
  isUploading,
  isUpdatingStatus,
  actionError,
  actionSuccess,
  canManageEvidence,
  onAttach,
  onRemoveAsset,
  onDropFiles,
  onUpload,
  onComplete,
}: {
  task: OperatorTask;
  selectedAssets: TaskEvidenceAsset[];
  isUploading: boolean;
  isUpdatingStatus: boolean;
  actionError: string | null;
  actionSuccess: string | null;
  canManageEvidence: boolean;
  onAttach: () => void;
  onRemoveAsset: (uri: string) => void;
  onDropFiles: (files: File[]) => void;
  onUpload: () => void;
  onComplete: () => void;
}) {
  const canAttach =
    task.estado !== 'COMPLETADA' && task.estado !== 'CERRADO';
  const status = getStatusPresentation(task.estado);

  return (
    <View style={styles.section}>
      <View style={styles.detailHero}>
        <View style={styles.detailHeroTop}>
          <Text style={styles.detailEyebrow}>TAREA #{task.id}</Text>
          <TaskStatusBadge status={task.estado} />
        </View>
        <Text style={styles.detailTitle}>{task.tipo_tarea}</Text>
        <Text style={styles.detailDate}>Asignada el {formatDate(task.fecha_creacion)}</Text>
        <View style={[styles.progressTrack, { backgroundColor: status.trackColor }]}>
          <View style={[styles.progressFill, { backgroundColor: status.color }]} />
        </View>
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.cardLabel}>DESCRIPCIÓN</Text>
        <Text style={styles.detailDescription}>{task.descripcion}</Text>
      </View>

      {task.novedades_ids.length > 0 ? (
        <View style={styles.detailCard}>
          <Text style={styles.cardLabel}>NOVEDADES RELACIONADAS</Text>
          <View style={styles.relatedNoveltyList}>
            {task.novedades_ids.map((noveltyId) => (
              <View key={noveltyId} style={styles.relatedNovelty}>
                <Text style={styles.relatedNoveltyText}>Novedad #{noveltyId}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.evidenceSection}>
        <View style={styles.evidenceSectionHeader}>
          <View>
            <Text style={styles.cardTitle}>Evidencias</Text>
            <Text style={styles.evidenceHint}>
              {task.evidencias.length} archivo{task.evidencias.length === 1 ? '' : 's'} enviado{task.evidencias.length === 1 ? '' : 's'}
            </Text>
          </View>
          {canAttach ? (
            <Pressable
              accessibilityRole="button"
              onPress={onAttach}
              style={styles.attachSmallButton}
            >
              <Text style={styles.attachSmallButtonText}>＋ Adjuntar</Text>
            </Pressable>
          ) : null}
        </View>

        {Platform.OS === 'web' && canAttach ? createElement('div', {
          onDragOver: (event: DragEvent) => event.preventDefault(),
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer?.files ?? []);
            if (files.length) onDropFiles(files);
          },
          style: { minHeight: 120 },
        }, <><View style={styles.dropZone}><Text style={styles.dropZoneTitle}>Suelta aquí tus evidencias</Text><Text style={styles.dropZoneCaption}>También puedes usar + Adjuntar para seleccionar archivos</Text></View><EvidenceGallery emptyMessage="Aún no has enviado evidencias para esta tarea." evidences={task.evidencias} taskId={task.id} /></>) : (
          <EvidenceGallery emptyMessage="Aún no has enviado evidencias para esta tarea." evidences={task.evidencias} taskId={task.id} />
        )}

        {selectedAssets.length ? (
          <View style={styles.selectedEvidence}>
            <Text style={styles.cardLabel}>LISTAS PARA SUBIR</Text>
            <View style={styles.previewGrid}>
              {selectedAssets.map((asset) => (
                <View key={asset.uri} style={styles.previewCard}>
                  {asset.mimeType.startsWith('image/') ? (
                    <Image source={{ uri: asset.uri }} style={styles.previewImage} />
                  ) : (
                    <View style={styles.videoPreview}>
                      <Text style={styles.videoPreviewIcon}>▶</Text>
                      <Text numberOfLines={1} style={styles.videoPreviewLabel}>
                        VIDEO
                      </Text>
                    </View>
                  )}
                  <Pressable
                    accessibilityLabel={`Eliminar ${asset.name}`}
                    accessibilityRole="button"
                    onPress={() => onRemoveAsset(asset.uri)}
                    style={styles.removeEvidenceButton}
                  >
                    <Text style={styles.removeEvidenceText}>×</Text>
                  </Pressable>
                  <Text numberOfLines={1} style={styles.previewName}>
                    {asset.name}
                  </Text>
                </View>
              ))}
            </View>
            <AppButton
              disabled={isUploading}
              loading={isUploading}
              onPress={onUpload}
              title="Subir evidencias"
            />
          </View>
        ) : null}
      </View>

      {actionError ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {actionError}
        </Text>
      ) : null}
      {actionSuccess ? (
        <Text accessibilityRole="alert" style={styles.actionSuccess}>
          {actionSuccess}
        </Text>
      ) : null}

      {task.estado === 'EN_PROCESO' && task.evidencias.length > 0 ? (
        <AppButton
          disabled={isUpdatingStatus}
          loading={isUpdatingStatus}
          onPress={onComplete}
          title="Marcar como completada"
        />
      ) : null}
    </View>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const presentation = getStatusPresentation(status);
  return (
    <View style={[styles.statusBadge, { backgroundColor: presentation.trackColor }]}>
      <View style={[styles.statusDot, { backgroundColor: presentation.color }]} />
      <Text style={[styles.statusBadgeText, { color: presentation.color }]}>
        {presentation.label}
      </Text>
    </View>
  );
}

function TaskCompletionModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [scale] = useState(() => new Animated.Value(1));

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, {
          toValue: 1.18,
          duration: 450,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scale, {
          toValue: 1,
          duration: 450,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    if (visible) animation.start();
    return () => animation.stop();
  }, [scale, visible]);

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.completionBackdrop}>
        <View style={styles.completionCard}>
          <Animated.View
            accessibilityLabel="Icono animado de felicitaciones"
            style={[
              styles.completionIcon,
              { transform: [{ scale }] },
            ]}
          >
            <Text style={styles.completionEmoji}>🎉</Text>
          </Animated.View>
          <Text style={styles.completionTitle}>¡Tarea completada!</Text>
          <Text style={styles.completionMessage}>
            Felicidades, has completado la tarea. El área de Operaciones
            validará y, si cumple con los criterios, tu novedad en SICO quedará
            cerrada.
          </Text>
          <AppButton onPress={onClose} title="Entendido" />
        </View>
      </View>
    </Modal>
  );
}

function TaskCompletionConfirmModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.completionBackdrop}>
        <View style={styles.confirmationCard}>
          <Text style={styles.confirmationTitle}>Completar tarea</Text>
          <Text style={styles.confirmationMessage}>
            ¿Confirmas que la tarea está lista para ser completada?
          </Text>
          <View style={styles.confirmationActions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={styles.confirmationSecondaryButton}
            >
              <Text style={styles.confirmationSecondaryButtonText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirm}
              style={styles.confirmationPrimaryButton}
            >
              <Text style={styles.confirmationPrimaryButtonText}>Completar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function MediaSourcePicker({
  visible,
  onDismiss,
  onClose,
  onTakePhoto,
  onRecordVideo,
  onChooseGallery,
  onChooseFiles,
}: {
  visible: boolean;
  onDismiss: () => void;
  onClose: () => void;
  onTakePhoto: () => void;
  onRecordVideo: () => void;
  onChooseGallery: () => void;
  onChooseFiles: () => void;
}) {
  return (
    <Modal
      animationType="slide"
      onDismiss={onDismiss}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View style={styles.pickerBackdrop}>
        <Pressable
          accessibilityLabel="Cerrar selección de evidencia"
          accessibilityRole="button"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.pickerSheet}>
          <View style={styles.pickerHandle} />
          <Text style={styles.cardTitle}>Adjuntar evidencia</Text>
          <Text style={styles.bodyText}>Elige cómo quieres agregar tus archivos.</Text>
          <MediaSourceButton icon="◉" label="Tomar Foto" onPress={onTakePhoto} />
          <MediaSourceButton icon="▶" label="Grabar Video" onPress={onRecordVideo} />
          <MediaSourceButton icon="▧" label="Seleccionar de Galería" onPress={onChooseGallery} />
          <MediaSourceButton icon="▤" label="Seleccionar Archivo" onPress={onChooseFiles} />
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancelButton}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function MediaSourceButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.sourceButton}>
      <View style={styles.sourceIcon}>
        <Text style={styles.sourceIconText}>{icon}</Text>
      </View>
      <Text style={styles.sourceButtonText}>{label}</Text>
      <Text style={styles.sourceArrow}>›</Text>
    </Pressable>
  );
}

function toTaskEvidenceAsset(
  asset: ImagePicker.ImagePickerAsset,
  capturedNow = false,
): TaskEvidenceAsset & { size: number } {
  const fileName = asset.fileName || asset.uri.split('/').pop() || `evidencia-${Date.now()}`;
  const extension = fileName.split('.').pop()?.toLowerCase();
  const detectedMimeType =
    asset.mimeType ??
    (asset.type === 'video'
      ? extension === 'mov'
        ? 'video/quicktime'
        : 'video/mp4'
      : extension === 'png'
        ? 'image/png'
        : extension === 'webp'
          ? 'image/webp'
          : extension === 'heic' || extension === 'heif'
            ? `image/${extension}`
            : 'image/jpeg');
  // Android can return camera captures with a UUID and no file extension.
  // The API validates both MIME type and extension, so make them agree.
  const mimeType = detectedMimeType.toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : detectedMimeType.toLowerCase();
  const expectedExtension = getEvidenceExtension(mimeType);
  const currentExtension = fileName.split('.').pop()?.toLowerCase();
  const normalizedFileName = expectedExtension
    && currentExtension !== expectedExtension
    ? `${fileName}.${expectedExtension}`
    : fileName;
  return {
    uri: asset.uri,
    name: normalizedFileName.replace(/[^\w.-]/g, '_'),
    mimeType,
    size: asset.fileSize ?? 0,
    durationMs: typeof asset.duration === 'number' ? asset.duration : undefined,
    capturedAt: capturedNow
      ? new Date(Date.now() - (asset.type === 'video' ? asset.duration ?? 0 : 0)).toISOString()
      : parseExifCaptureTime(asset.exif?.DateTimeOriginal),
  };
}

function getEvidenceExtension(mimeType: string): string | null {
  switch (mimeType) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    case 'video/mp4': return 'mp4';
    case 'video/quicktime': return 'mov';
    default: return null;
  }
}

function toTaskEvidenceAssetFromDocument(
  asset: DocumentPicker.DocumentPickerAsset,
): TaskEvidenceAsset | null {
  const mimeType = asset.mimeType ?? getMimeTypeFromFileName(asset.name);
  if (!mimeType || !SUPPORTED_EVIDENCE_TYPES.has(mimeType)) {
    return null;
  }
  return {
    uri: asset.uri,
    name: asset.name.replace(/[^\w.-]/g, '_'),
    mimeType,
    size: asset.size,
    capturedAt: asset.lastModified ? new Date(asset.lastModified).toISOString() : undefined,
  };
}

function releaseWebAsset(asset: TaskEvidenceAsset) {
  if (Platform.OS === 'web' && asset.webFile && asset.uri.startsWith('blob:')) {
    URL.revokeObjectURL(asset.uri);
  }
}

function inferEvidenceMimeType(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic') return 'image/heic';
  if (extension === 'heif') return 'image/heif';
  if (extension === 'mov') return 'video/quicktime';
  if (extension === 'mp4') return 'video/mp4';
  return '';
}

function parseExifCaptureTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}-05:00`).toISOString();
}

function getMimeTypeFromFileName(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic' || extension === 'heif') return `image/${extension}`;
  if (extension === 'mp4' || extension === 'm4v') return 'video/mp4';
  if (extension === 'mov') return 'video/quicktime';
  return null;
}

function getStatusPresentation(status: TaskStatus): {
  label: string;
  color: string;
  trackColor: string;
} {
  if (status === 'CERRADO') {
    return { label: 'Cerrada', color: '#52606D', trackColor: '#EEF1F4' };
  }
  if (status === 'COMPLETADA') {
    return { label: 'Completada', color: '#20845A', trackColor: '#E8F5EC' };
  }
  if (status === 'EN_PROCESO') {
    return { label: 'En proceso', color: '#A86A00', trackColor: '#FFF4D8' };
  }
  return { label: 'Pendiente', color: colors.danger, trackColor: '#FFF0F0' };
}

function formatDate(value: string): string {
  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.medium,
  },
  loader: {
    padding: spacing.xxlarge,
  },
  noticeCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.small,
    padding: spacing.large,
  },
  noticeTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 21,
  },
  retryText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '800',
    paddingVertical: spacing.xsmall,
  },
  taskList: {
    gap: spacing.medium,
  },
  dropZone: { alignItems: 'center', backgroundColor: '#FFFAFA', borderColor: '#E9CACA', borderRadius: radius.medium, borderStyle: 'dashed', borderWidth: 1, justifyContent: 'center', marginBottom: spacing.medium, minHeight: 78, padding: spacing.medium },
  dropZoneTitle: { color: colors.text, fontSize: typography.small, fontWeight: '800' },
  dropZoneCaption: { color: colors.textMuted, fontSize: typography.overline, marginTop: 4 },
  taskCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.medium,
  },
  taskCardPressed: {
    opacity: 0.82,
  },
  taskCardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.small,
    justifyContent: 'space-between',
  },
  taskCardTitle: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    fontWeight: '800',
    lineHeight: 22,
  },
  statusBadge: {
    alignItems: 'center',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xsmall,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  statusBadgeText: {
    fontSize: typography.overline,
    fontWeight: '800',
  },
  statusDot: {
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  taskCardFooter: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.medium,
    paddingTop: spacing.small,
  },
  taskCardDate: {
    color: colors.textMuted,
    flex: 1,
    fontSize: typography.small,
  },
  taskCardEvidence: {
    color: colors.textSecondary,
    fontSize: typography.small,
    fontWeight: '600',
  },
  taskCardArrow: {
    fontSize: 26,
    lineHeight: 28,
  },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.small,
    padding: spacing.xxlarge,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: '#E8F5EC',
    borderRadius: radius.pill,
    height: 48,
    justifyContent: 'center',
    marginBottom: spacing.small,
    width: 48,
  },
  emptyIconText: {
    color: '#20845A',
    fontSize: typography.heading,
    fontWeight: '800',
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 42,
    justifyContent: 'center',
    paddingRight: spacing.medium,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  detailHero: {
    backgroundColor: colors.navy,
    borderRadius: radius.large,
    gap: spacing.medium,
    padding: spacing.large,
  },
  detailHeroTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    color: colors.whiteMuted,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 1,
  },
  detailTitle: {
    color: colors.white,
    fontSize: typography.heading,
    fontWeight: '800',
    lineHeight: 27,
  },
  detailDate: {
    color: colors.whiteMuted,
    fontSize: typography.small,
  },
  progressTrack: {
    borderRadius: radius.pill,
    height: 5,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: radius.pill,
    height: 5,
    width: '100%',
  },
  detailCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.small,
    padding: spacing.medium,
  },
  cardLabel: {
    color: colors.textMuted,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  detailDescription: {
    color: colors.text,
    fontSize: typography.caption,
    lineHeight: 22,
  },
  relatedNoveltyList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xsmall,
  },
  relatedNovelty: {
    backgroundColor: '#FFF1F1',
    borderRadius: radius.small,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  relatedNoveltyText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '700',
  },
  evidenceSection: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.medium,
  },
  evidenceSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  evidenceHint: {
    color: colors.textMuted,
    fontSize: typography.small,
    marginTop: 2,
  },
  attachSmallButton: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.medium,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: spacing.medium,
  },
  attachSmallButtonText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '800',
  },
  selectedEvidence: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.medium,
    paddingTop: spacing.medium,
  },
  previewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.small,
  },
  previewCard: {
    backgroundColor: '#FFFAFA',
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    overflow: 'hidden',
    width: '47%',
  },
  previewImage: {
    backgroundColor: colors.background,
    height: 112,
    width: '100%',
  },
  videoPreview: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    gap: spacing.xsmall,
    height: 112,
    justifyContent: 'center',
  },
  videoPreviewIcon: {
    color: colors.white,
    fontSize: 30,
  },
  videoPreviewLabel: {
    color: colors.whiteMuted,
    fontSize: typography.overline,
    fontWeight: '800',
  },
  removeEvidenceButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.pill,
    elevation: 2,
    height: 30,
    justifyContent: 'center',
    position: 'absolute',
    right: spacing.xsmall,
    top: spacing.xsmall,
    width: 30,
  },
  removeEvidenceText: {
    color: colors.danger,
    fontSize: 22,
    lineHeight: 25,
  },
  previewName: {
    color: colors.textSecondary,
    fontSize: typography.overline,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  actionError: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: '600',
  },
  actionSuccess: {
    color: '#20845A',
    fontSize: typography.small,
    fontWeight: '700',
  },
  completionBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 27, 45, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.large,
  },
  completionCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.large,
    gap: spacing.medium,
    maxWidth: 420,
    padding: spacing.large,
    width: '100%',
  },
  confirmationCard: {
    backgroundColor: colors.white,
    borderRadius: radius.large,
    gap: spacing.medium,
    maxWidth: 420,
    padding: spacing.large,
    width: '100%',
  },
  completionIcon: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.pill,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  completionEmoji: {
    fontSize: 42,
  },
  completionTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '800',
    textAlign: 'center',
  },
  completionMessage: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 23,
    textAlign: 'center',
  },
  confirmationTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '800',
    textAlign: 'center',
  },
  confirmationMessage: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 23,
    textAlign: 'center',
  },
  confirmationActions: {
    flexDirection: 'row',
    gap: spacing.small,
    marginTop: spacing.small,
  },
  confirmationSecondaryButton: {
    alignItems: 'center',
    backgroundColor: colors.whiteMuted,
    borderRadius: radius.medium,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.medium,
  },
  confirmationSecondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  confirmationPrimaryButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.medium,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: spacing.medium,
  },
  confirmationPrimaryButtonText: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  pickerBackdrop: {
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.large,
    borderTopRightRadius: radius.large,
    gap: spacing.small,
    paddingBottom: spacing.xxlarge,
    paddingHorizontal: spacing.large,
    paddingTop: spacing.medium,
  },
  pickerHandle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    height: 4,
    marginBottom: spacing.small,
    width: 42,
  },
  sourceButton: {
    alignItems: 'center',
    backgroundColor: '#FFFAFA',
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.medium,
    minHeight: 58,
    paddingHorizontal: spacing.medium,
  },
  sourceIcon: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.small,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sourceIconText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  sourceButtonText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  sourceArrow: {
    color: colors.textMuted,
    fontSize: 26,
  },
  cancelButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
