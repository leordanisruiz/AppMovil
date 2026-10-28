import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  PanResponder,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppButton } from './AppButton';
import { EvidenceGallery } from './EvidenceGallery';
import { SectionHeading } from './SectionHeading';
import { useTareasCreadas } from '../hooks/useTareasCreadas';
import { getApiErrorMessage } from '../services/authService';
import { tareasService } from '../services/tareasService';
import { useAuth } from '../store/AuthProvider';
import { colors, radius, spacing, typography } from '../theme';
import type { OperatorTask, TaskStatus } from '../types/tarea';

const PAGE_SIZE = 6;

export function CreatedTasksSection() {
  const queryClient = useQueryClient();
  const { operator } = useAuth();
  const canManageEvidence = operator?.rolId === 1 || operator?.rolId === 2;
  const tasksQuery = useTareasCreadas(true);
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
          if (selectedTaskId !== null && gesture.dx >= 92) {
            setSelectedTaskId(null);
            setCloseError(null);
          }
        },
      }),
    [selectedTaskId],
  );
  const [currentPage, setCurrentPage] = useState(1);
  const [closedTask, setClosedTask] = useState<OperatorTask | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [warningMotion] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!closeError) return;
    warningMotion.setValue(0);
    const animation = Animated.sequence([
      Animated.timing(warningMotion, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(warningMotion, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(warningMotion, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(warningMotion, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [closeError, warningMotion]);
  const detailQuery = useQuery({
    queryKey: ['tarea-creada', selectedTaskId],
    queryFn: () => tareasService.getCreatedById(selectedTaskId!),
    enabled: selectedTaskId !== null,
    staleTime: 0,
  });

  const closeTaskMutation = useMutation({
    mutationFn: tareasService.closeCreated,
    onSuccess: async (task) => {
      queryClient.setQueryData(['tarea-creada', task.id], task);
      queryClient.setQueryData<OperatorTask[]>(['tareas-creadas'], (tasks) =>
        tasks?.map((current) => (current.id === task.id ? task : current)),
      );
      await queryClient.invalidateQueries({ queryKey: ['tareas-creadas'] });
      setCloseError(null);
      setClosedTask(task);
    },
    onError: (error: unknown) => {
      setCloseError(
        getApiErrorMessage(error, 'No fue posible cerrar la tarea. Inténtalo nuevamente.'),
      );
    },
  });

  const tasks = tasksQuery.data ?? [];
  const pageCount = Math.max(1, Math.ceil(tasks.length / PAGE_SIZE));
  const page = Math.min(currentPage, pageCount);
  const pageTasks = tasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    if (selectedTaskId === null) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedTaskId(null);
      setCloseError(null);
      return true;
    });
    return () => subscription.remove();
  }, [selectedTaskId]);

  if (selectedTaskId !== null) {
    const task = detailQuery.data;
    return (
      <View style={styles.section} {...detailBackSwipe.panHandlers}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setSelectedTaskId(null);
            setCloseError(null);
          }}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>‹  Volver a tareas creadas</Text>
        </Pressable>

        {detailQuery.isLoading ? (
          <ActivityIndicator color={colors.primary} style={styles.loader} />
        ) : detailQuery.isError || !task ? (
          <View style={styles.messageCard}>
            <Text style={styles.bodyText}>
              No fue posible cargar el detalle de la tarea.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void detailQuery.refetch()}
            >
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <CreatedTaskDetail
            task={task}
            isClosing={closeTaskMutation.isPending}
            closeError={closeError}
            canManageEvidence={canManageEvidence}
            onCloseTask={() => closeTaskMutation.mutate(task.id)}
          />
        )}

        <Modal
          animationType="fade"
          onRequestClose={() => setClosedTask(null)}
          transparent
          visible={closedTask !== null}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.successModal}>
              <View style={styles.successIcon}>
                <Text style={styles.successIconText}>✓</Text>
              </View>
              <Text style={styles.successTitle}>Tarea cerrada</Text>
              <Text style={styles.successMessage}>
                {closedTask
                  ? getClosedMessage(closedTask)
                  : ''}
              </Text>
              {closedTask?.novedades_ids.length ? (
                <Text style={styles.successFollowUp}>
                  Por favor, recuerda realizar el cierre de la novedad/es{' '}
                  {closedTask.novedades_ids.map((id) => `#${id}`).join(', ')} en la
                  {' '}plataforma de <Text style={styles.successFollowUpBold}>SICO</Text>.
                </Text>
              ) : null}
              <AppButton
                onPress={() => setClosedTask(null)}
                title="Entendido"
              />
            </View>
          </View>
        </Modal>
        <Modal
          animationType="fade"
          onRequestClose={() => setCloseError(null)}
          transparent
          visible={closeError !== null}
        >
          <View style={styles.modalBackdrop}>
            <View accessibilityViewIsModal style={styles.warningModal}>
              <Animated.View
                style={[
                  styles.warningIcon,
                  {
                    transform: [
                      { scale: warningMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }) },
                      { rotate: warningMotion.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) },
                    ],
                  },
                ]}
              >
                <Text style={styles.warningIconText}>!</Text>
              </Animated.View>
              <Text style={styles.warningTitle}>El operador aún no ha gestionado esta tarea</Text>
              <Text accessibilityRole="alert" style={styles.warningMessage}>
                {closeError}
              </Text>
              <AppButton onPress={() => setCloseError(null)} title="Entendido" />
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={[styles.section, Platform.OS === 'web' && styles.webSection]}>
      <SectionHeading
        title="Tareas creadas"
        supportingText="Haz seguimiento a las tareas que asignaste a los operadores."
      />

      {tasksQuery.isLoading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : tasksQuery.isError ? (
        <View style={styles.messageCard}>
          <Text style={styles.bodyText}>
            No fue posible cargar las tareas que creaste.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void tasksQuery.refetch()}
          >
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
        </View>
      ) : tasks.length === 0 ? (
        <View style={styles.messageCard}>
          <Text style={styles.emptyTitle}>Aún no has creado tareas</Text>
          <Text style={styles.bodyText}>
            Las tareas que asignes a los operadores aparecerán aquí para que
            puedas hacerles seguimiento.
          </Text>
        </View>
      ) : (
        <View style={styles.tableCard}>
          <Text style={styles.tableHint}>
            Toca una fila para consultar el detalle y las evidencias.
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={Platform.OS === 'web' ? styles.webTableContent : undefined}>
              <View style={[styles.tableRow, styles.tableHeader, Platform.OS === 'web' && styles.webTableRow]}>
                <TableCell label="ID" style={styles.idColumn} header />
                <TableCell label="Fecha" style={styles.dateColumn} header />
                <TableCell label="Tarea" style={styles.taskColumn} header />
                <TableCell label="Operador" style={styles.operatorColumn} header />
                <TableCell label="Estado" style={styles.statusColumn} header />
                <TableCell label="Evidencias" style={styles.evidenceColumn} header />
              </View>
              {pageTasks.map((task, index) => (
                <Pressable
                  accessibilityRole="button"
                  key={task.id}
                  onPress={() => {
                    setCloseError(null);
                    setSelectedTaskId(task.id);
                  }}
                  style={[
                    styles.tableRow,
                    index % 2 === 1 && styles.tableRowAlternate,
                    Platform.OS === 'web' && styles.webTableRow,
                  ]}
                >
                  <TableCell label={`#${task.id}`} style={styles.idColumn} />
                  <TableCell
                    label={formatDate(task.fecha_creacion)}
                    style={styles.dateColumn}
                  />
                  <TableCell label={task.tipo_tarea} style={styles.taskColumn} />
                  <TableCell
                    label={String(task.operador_id)}
                    style={styles.operatorColumn}
                  />
                  <View style={[styles.statusColumn, styles.tableCellView, Platform.OS === 'web' && styles.webColumn]}>
                    <StatusBadge status={task.estado} />
                  </View>
                  <TableCell
                    label={String(task.evidencias.length)}
                    style={styles.evidenceColumn}
                  />
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <View style={styles.pagination}>
            <Text style={styles.paginationLabel}>
              {tasks.length === 0
                ? '0 tareas'
                : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(
                    page * PAGE_SIZE,
                    tasks.length,
                  )} de ${tasks.length}`}
            </Text>
            <View style={styles.paginationActions}>
              <Pressable
                accessibilityLabel="Página anterior"
                accessibilityRole="button"
                accessibilityState={{ disabled: page <= 1 }}
                disabled={page <= 1}
                onPress={() => setCurrentPage(page - 1)}
                style={[
                  styles.pageButton,
                  page <= 1 && styles.pageButtonDisabled,
                ]}
              >
                <Text style={styles.pageButtonText}>‹</Text>
              </Pressable>
              <Text style={styles.pageNumber}>
                {page} / {pageCount}
              </Text>
              <Pressable
                accessibilityLabel="Página siguiente"
                accessibilityRole="button"
                accessibilityState={{ disabled: page >= pageCount }}
                disabled={page >= pageCount}
                onPress={() => setCurrentPage(page + 1)}
                style={[
                  styles.pageButton,
                  page >= pageCount && styles.pageButtonDisabled,
                ]}
              >
                <Text style={styles.pageButtonText}>›</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function CreatedTaskDetail({
  task,
  isClosing,
  closeError,
  canManageEvidence,
  onCloseTask,
}: {
  task: OperatorTask;
  isClosing: boolean;
  closeError: string | null;
  canManageEvidence: boolean;
  onCloseTask: () => void;
}) {
  return (
    <View style={styles.detailContent}>
      <View style={styles.detailHero}>
        <View style={styles.detailHeader}>
          <Text style={styles.detailEyebrow}>SEGUIMIENTO DE TAREA #{task.id}</Text>
          <StatusBadge status={task.estado} />
        </View>
        <Text style={styles.detailTitle}>{task.tipo_tarea}</Text>
        <Text style={styles.detailDate}>
          Creada el {formatDate(task.fecha_creacion)}
        </Text>
      </View>

      <View style={styles.detailCard}>
        <DetailRow label="Operador asignado" value={`#${task.operador_id}`} />
        <DetailRow label="Estado" value={getStatusLabel(task.estado)} />
        <DetailRow label="Descripción" value={task.descripcion} />
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.cardTitle}>
          Novedades relacionadas ({task.novedades_ids.length})
        </Text>
        {task.novedades_ids.length ? (
          <View style={styles.noveltyList}>
            {task.novedades_ids.map((noveltyId) => (
              <View key={noveltyId} style={styles.noveltyChip}>
                <Text style={styles.noveltyText}>Novedad #{noveltyId}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.bodyText}>Esta tarea no tiene novedades asociadas.</Text>
        )}
      </View>

      <View style={styles.detailCard}>
        <Text style={styles.cardTitle}>
          Evidencias ({task.evidencias.length})
        </Text>
        <EvidenceGallery
          emptyMessage="El operador aún no ha cargado evidencias."
          evidences={task.evidencias}
          taskId={task.id}
        />
      </View>

      {task.estado === 'COMPLETADA' ? (
        <AppButton
          disabled={isClosing}
          loading={isClosing}
          onPress={onCloseTask}
          title="Cerrar tarea"
        />
      ) : task.estado === 'CERRADO' ? (
        <View style={styles.completedNote}>
          <Text style={styles.completedNoteText}>✓ Esta tarea ya está cerrada.</Text>
        </View>
      ) : null}
      {closeError ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          {closeError}
        </Text>
      ) : null}
    </View>
  );
}

function TableCell({
  label,
  style,
  header = false,
}: {
  label: string;
  style: object;
  header?: boolean;
}) {
  return (
    <Text
      numberOfLines={header ? 1 : 2}
      style={[
        styles.tableCell,
        style,
        Platform.OS === 'web' && styles.webColumn,
        header && styles.tableHeaderText,
      ]}
    >
      {label}
    </Text>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const closed = status === 'CERRADO';
  const completed = status === 'COMPLETADA';
  const inProgress = status === 'EN_PROCESO';
  return (
    <View
      style={[
        styles.statusBadge,
        completed
          ? styles.statusCompleted
          : closed
            ? styles.statusClosed
            : inProgress
            ? styles.statusInProgress
            : styles.statusPending,
      ]}
    >
      <View
        style={[
          styles.statusDot,
          completed
            ? styles.statusDotCompleted
            : closed
              ? styles.statusDotClosed
              : inProgress
              ? styles.statusDotInProgress
              : styles.statusDotPending,
        ]}
      />
      <Text
        style={[
          styles.statusText,
          completed
            ? styles.statusTextCompleted
            : closed
              ? styles.statusTextClosed
              : inProgress
              ? styles.statusTextInProgress
              : styles.statusTextPending,
        ]}
      >
        {getStatusLabel(status)}
      </Text>
    </View>
  );
}

function getStatusLabel(status: TaskStatus): string {
  if (status === 'CERRADO') return 'Cerrada';
  if (status === 'COMPLETADA') return 'Completada';
  if (status === 'EN_PROCESO') return 'En proceso';
  return 'Pendiente';
}

function getClosedMessage(task: OperatorTask): string {
  const noveltyNumbers = task.novedades_ids.map((id) => `#${id}`).join(', ');
  return noveltyNumbers
    ? `La tarea #${task.id} quedó en estado CERRADO. Novedad${task.novedades_ids.length > 1 ? 'es asociadas' : ' asociada'}: ${noveltyNumbers}.`
    : `La tarea #${task.id} quedó en estado CERRADO.`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.medium,
  },
  webSection: { alignSelf: 'center', maxWidth: 1120, width: '100%' },
  webTableContent: { minWidth: '100%' },
  webTableRow: { width: '100%' },
  webColumn: { flexGrow: 1 },
  loader: {
    padding: spacing.large,
  },
  backButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 42,
    paddingRight: spacing.medium,
  },
  backButtonText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  messageCard: {
    alignItems: 'flex-start',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.small,
    padding: spacing.large,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  bodyText: {
    color: colors.textSecondary,
    fontSize: typography.small,
    lineHeight: 20,
  },
  retryText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '800',
    paddingVertical: spacing.xsmall,
  },
  tableCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    overflow: 'hidden',
    paddingVertical: spacing.small,
  },
  tableHint: {
    color: colors.textMuted,
    fontSize: typography.small,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
  },
  tableRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 56,
  },
  tableHeader: {
    backgroundColor: '#FFF6F6',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
  },
  tableRowAlternate: {
    backgroundColor: '#FFFAFA',
  },
  tableCell: {
    color: colors.textSecondary,
    fontSize: typography.small,
    justifyContent: 'center',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.small,
  },
  tableHeaderText: {
    color: colors.textMuted,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  idColumn: {
    width: 66,
  },
  dateColumn: {
    width: 92,
  },
  taskColumn: {
    width: 150,
  },
  operatorColumn: {
    width: 100,
  },
  statusColumn: {
    width: 126,
  },
  evidenceColumn: {
    textAlign: 'center',
    width: 88,
  },
  tableCellView: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: spacing.small,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.small,
    paddingHorizontal: spacing.medium,
    paddingTop: spacing.small,
  },
  paginationLabel: {
    color: colors.textMuted,
    fontSize: typography.small,
  },
  paginationActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.small,
  },
  pageButton: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.small,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  pageButtonDisabled: {
    backgroundColor: colors.background,
  },
  pageButtonText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  pageNumber: {
    color: colors.textSecondary,
    fontSize: typography.small,
    fontWeight: '700',
  },
  detailContent: {
    gap: spacing.medium,
  },
  detailHero: {
    backgroundColor: colors.navy,
    borderRadius: radius.large,
    gap: spacing.medium,
    padding: spacing.large,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.small,
    justifyContent: 'space-between',
  },
  detailEyebrow: {
    color: colors.whiteMuted,
    flexShrink: 1,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  detailTitle: {
    color: colors.white,
    fontSize: typography.heading,
    fontWeight: '800',
  },
  detailDate: {
    color: colors.whiteMuted,
    fontSize: typography.small,
  },
  detailCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.medium,
  },
  detailRow: {
    gap: spacing.xsmall,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  detailValue: {
    color: colors.text,
    fontSize: typography.small,
    lineHeight: 21,
  },
  cardTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '800',
  },
  noveltyList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.small,
  },
  noveltyChip: {
    backgroundColor: '#FFF0F0',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
  },
  noveltyText: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '700',
  },
  statusBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xsmall,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  statusPending: {
    backgroundColor: '#FFF0F0',
  },
  statusInProgress: {
    backgroundColor: '#FFF4D8',
  },
  statusCompleted: {
    backgroundColor: '#E8F5EC',
  },
  statusClosed: {
    backgroundColor: '#EEF1F4',
  },
  statusDot: {
    borderRadius: radius.pill,
    height: 7,
    width: 7,
  },
  statusDotPending: {
    backgroundColor: colors.danger,
  },
  statusDotInProgress: {
    backgroundColor: '#A86A00',
  },
  statusDotCompleted: {
    backgroundColor: '#20845A',
  },
  statusDotClosed: {
    backgroundColor: '#52606D',
  },
  statusText: {
    fontSize: typography.overline,
    fontWeight: '800',
  },
  statusTextPending: {
    color: colors.danger,
  },
  statusTextInProgress: {
    color: '#A86A00',
  },
  statusTextCompleted: {
    color: '#20845A',
  },
  statusTextClosed: {
    color: '#52606D',
  },
  completedNote: {
    alignItems: 'center',
    backgroundColor: '#E8F5EC',
    borderRadius: radius.medium,
    padding: spacing.medium,
  },
  completedNoteText: {
    color: '#20845A',
    fontSize: typography.caption,
    fontWeight: '800',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: '600',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(12, 27, 45, 0.58)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.large,
  },
  successModal: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.large,
    gap: spacing.medium,
    maxWidth: 420,
    padding: spacing.large,
    width: '100%',
  },
  successIcon: {
    alignItems: 'center',
    backgroundColor: '#E8F5EC',
    borderRadius: radius.pill,
    height: 54,
    justifyContent: 'center',
    width: 54,
  },
  successIconText: {
    color: '#20845A',
    fontSize: typography.heading,
    fontWeight: '900',
  },
  successTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '800',
    textAlign: 'center',
  },
  successMessage: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 23,
    textAlign: 'center',
  },
  successFollowUp: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 23,
    textAlign: 'center',
  },
  successFollowUpBold: {
    color: colors.textSecondary,
    fontWeight: '800',
  },
  warningModal: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radius.large,
    gap: spacing.medium,
    marginHorizontal: spacing.large,
    padding: spacing.large,
  },
  warningIcon: {
    alignItems: 'center',
    backgroundColor: '#FFF0E8',
    borderColor: '#F4B183',
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  warningIconText: {
    color: '#B54708',
    fontSize: 38,
    fontWeight: '900',
  },
  warningTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '800',
    textAlign: 'center',
  },
  warningMessage: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 23,
    textAlign: 'center',
  },
});
