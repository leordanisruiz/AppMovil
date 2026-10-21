import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getApiErrorMessage } from '../services/authService';
import { tareasService } from '../services/tareasService';
import type {
  AssignableNovelty,
  AssignableOperator,
  TaskTypeOption,
} from '../types/tarea';
import { colors, radius, spacing, typography } from '../theme';
import { AppButton } from './AppButton';
import { SectionHeading } from './SectionHeading';

type SearchMode = 'operador' | 'novedad';

export function TaskAssignmentSection() {
  const queryClient = useQueryClient();
  const [searchMode, setSearchMode] = useState<SearchMode>('operador');
  const [searchText, setSearchText] = useState('');
  const [operator, setOperator] = useState<AssignableOperator | null>(null);
  const [directNovelty, setDirectNovelty] = useState<AssignableNovelty | null>(null);
  const [selectedNoveltyIds, setSelectedNoveltyIds] = useState<number[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<{
    taskId: number;
    notificationCount: number;
  } | null>(null);

  const typesQuery = useQuery({
    queryKey: ['task-types'],
    queryFn: tareasService.getTaskTypes,
  });
  const noveltiesQuery = useQuery({
    queryKey: ['assignment-novelties', operator?.codigo],
    queryFn: () => tareasService.getOperatorNovelties(operator!.codigo),
    enabled: operator !== null && directNovelty === null,
  });
  const operatorSearch = useMutation({
    mutationFn: tareasService.searchOperators,
    onSuccess: (results) => {
      setErrorMessage(null);
      if (results.length === 0) setFeedback('No encontramos operadores con ese dato.');
    },
    onError: (error: unknown) => {
      setErrorMessage(getApiErrorMessage(error, 'No fue posible buscar operadores.'));
    },
  });
  const noveltySearch = useMutation({
    mutationFn: tareasService.getNovelty,
    onSuccess: (novelty) => {
      setErrorMessage(null);
      setOperator({
        codigo: String(novelty.codigo),
        tipo_documento: novelty.tipo_documento ?? '',
        identificacion: novelty.identificacion ?? '',
        nombre_completo: novelty.nombre_completo ?? 'Operador',
      });
      setDirectNovelty(novelty);
      setSelectedNoveltyIds([novelty.id_novedad]);
      setFeedback(null);
    },
    onError: (error: unknown) => {
      setErrorMessage(getApiErrorMessage(error, 'No fue posible buscar la novedad.'));
    },
  });
  const assignment = useMutation({
    mutationFn: () => {
      if (!operator || selectedTypeId === null) {
        throw new Error('Selecciona el operador y el tipo de tarea.');
      }
      return tareasService.createAssignment({
        operador_id: Number(operator.codigo),
        novedades_ids: selectedNoveltyIds,
        tipo_tarea_id: selectedTypeId,
        descripcion: description.trim(),
      });
    },
    onSuccess: async (response) => {
      setSuccessNotice({
        taskId: response.tarea.id,
        notificationCount: response.notificaciones_programadas,
      });
      setFeedback(null);
      await queryClient.invalidateQueries({ queryKey: ['tareas'] });
      await queryClient.invalidateQueries({ queryKey: ['tareas-creadas'] });
      setErrorMessage(null);
      setOperator(null);
      setDirectNovelty(null);
      setSelectedNoveltyIds([]);
      setSelectedTypeId(null);
      setDescription('');
      setSearchText('');
      operatorSearch.reset();
      noveltySearch.reset();
    },
    onError: (error: unknown) => {
      setErrorMessage(getApiErrorMessage(error, 'No fue posible asignar la tarea.'));
    },
  });

  const search = () => {
    const term = searchText.trim();
    if (term.length < 2) {
      setErrorMessage('Escribe al menos dos caracteres para buscar.');
      return;
    }
    setErrorMessage(null);
    setFeedback(null);
    setOperator(null);
    setDirectNovelty(null);
    setSelectedNoveltyIds([]);
    operatorSearch.reset();
    noveltySearch.reset();
    if (searchMode === 'operador') {
      operatorSearch.mutate(term);
    } else if (/^\d+$/.test(term)) {
      noveltySearch.mutate(Number(term));
    } else {
      setErrorMessage('El ID de la novedad debe contener solo números.');
    }
  };

  const chooseOperator = (chosen: AssignableOperator) => {
    setOperator(chosen);
    setDirectNovelty(null);
    setSelectedNoveltyIds([]);
    setFeedback(null);
  };

  const toggleNovelty = (noveltyId: number) => {
    setSelectedNoveltyIds((selected) =>
      selected.includes(noveltyId)
        ? selected.filter((id) => id !== noveltyId)
        : [...selected, noveltyId],
    );
  };

  const canAssign =
    operator !== null &&
    selectedNoveltyIds.length > 0 &&
    selectedTypeId !== null &&
    description.trim().length > 0 &&
    !assignment.isPending;

  return (
    <View style={styles.section}>
      <SectionHeading
        title="Asignación de tareas"
        supportingText="Busca al operador, relaciona las novedades y completa los datos de la actividad."
      />

      <View style={styles.card}>
        <Text style={styles.fieldLabel}>BUSCAR POR</Text>
        <View style={styles.modeRow}>
          <ModeButton
            active={searchMode === 'operador'}
            label="Operador"
            onPress={() => {
              setSearchMode('operador');
              setErrorMessage(null);
            }}
          />
          <ModeButton
            active={searchMode === 'novedad'}
            label="ID de novedad"
            onPress={() => {
              setSearchMode('novedad');
              setErrorMessage(null);
            }}
          />
        </View>
        <TextInput
          accessibilityLabel={
            searchMode === 'operador'
              ? 'Buscar operador por código o identificación'
              : 'Buscar novedad por ID'
          }
          keyboardType={searchMode === 'novedad' ? 'number-pad' : 'default'}
          onChangeText={setSearchText}
          onSubmitEditing={search}
          placeholder={
            searchMode === 'operador'
              ? 'Código o identificación'
              : 'Número de la novedad'
          }
          returnKeyType="search"
          style={styles.searchInput}
          value={searchText}
        />
        <AppButton
          disabled={operatorSearch.isPending || noveltySearch.isPending}
          loading={operatorSearch.isPending || noveltySearch.isPending}
          onPress={search}
          title="Buscar"
        />
      </View>

      {operator === null && operatorSearch.data?.length ? (
        <View style={styles.resultCard}>
          <Text style={styles.cardTitle}>Resultados de operadores</Text>
          {operatorSearch.data.map((result) => (
            <Pressable
              accessibilityRole="button"
              key={`${result.codigo}-${result.identificacion}`}
              onPress={() => chooseOperator(result)}
              style={styles.operatorResult}
            >
              <View style={styles.resultMark}>
                <Text style={styles.resultMarkText}>O</Text>
              </View>
              <View style={styles.resultCopy}>
                <Text style={styles.operatorName}>{result.nombre_completo}</Text>
                <Text style={styles.secondaryText}>
                  {result.codigo} · {result.tipo_documento}-{result.identificacion}
                </Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {operator ? (
        <View style={styles.resultCard}>
          <View style={styles.selectedOperator}>
            <View style={styles.resultMark}>
              <Text style={styles.resultMarkText}>✓</Text>
            </View>
            <View style={styles.resultCopy}>
              <Text style={styles.cardTitle}>{operator.nombre_completo}</Text>
              <Text style={styles.secondaryText}>
                Código {operator.codigo} · {operator.tipo_documento}-{operator.identificacion}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setOperator(null);
                setDirectNovelty(null);
                setSelectedNoveltyIds([]);
              }}
            >
              <Text style={styles.changeText}>Cambiar</Text>
            </Pressable>
          </View>

          <Text style={styles.cardTitle}>Novedades abiertas</Text>
          {directNovelty ? (
            <NoveltyRow
              novelty={directNovelty}
              selected={selectedNoveltyIds.includes(directNovelty.id_novedad)}
              onPress={() => toggleNovelty(directNovelty.id_novedad)}
            />
          ) : noveltiesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : noveltiesQuery.isError ? (
            <Feedback
              message="No fue posible cargar las novedades de este operador."
              onRetry={() => void noveltiesQuery.refetch()}
            />
          ) : noveltiesQuery.data?.length ? (
            <ScrollView style={styles.noveltyList} nestedScrollEnabled>
              {[...noveltiesQuery.data]
                .sort(compareNoveltyDates)
                .map((novelty) => (
                  <NoveltyRow
                    key={novelty.id_novedad}
                    novelty={novelty}
                    selected={selectedNoveltyIds.includes(novelty.id_novedad)}
                    onPress={() => toggleNovelty(novelty.id_novedad)}
                  />
                ))}
            </ScrollView>
          ) : (
            <Text style={styles.secondaryText}>
              Este operador no tiene novedades abiertas para asociar.
            </Text>
          )}

          <Text style={styles.fieldLabel}>TIPO DE TAREA</Text>
          {typesQuery.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : typesQuery.isError ? (
            <Feedback
              message="No fue posible cargar los tipos de tarea."
              onRetry={() => void typesQuery.refetch()}
            />
          ) : (
            <View style={styles.typesList}>
              {typesQuery.data?.map((type) => (
                <TypeOption
                  key={type.id}
                  option={type}
                  selected={type.id === selectedTypeId}
                  onPress={() => setSelectedTypeId(type.id)}
                />
              ))}
            </View>
          )}

          <Text style={styles.fieldLabel}>DESCRIPCIÓN</Text>
          <TextInput
            accessibilityLabel="Descripción de la tarea"
            multiline
            onChangeText={setDescription}
            placeholder="Escribe brevemente qué debe realizar el operador."
            style={styles.descriptionInput}
            textAlignVertical="top"
            value={description}
          />
          {selectedNoveltyIds.length > 0 ? (
            <Text style={styles.selectionCaption}>
              {selectedNoveltyIds.length} novedad(es) seleccionada(s)
            </Text>
          ) : null}
          <AppButton
            disabled={!canAssign}
            loading={assignment.isPending}
            onPress={() => assignment.mutate()}
            title="Crear y asignar tarea"
          />
        </View>
      ) : null}

      {feedback ? (
        <View style={styles.feedbackCard}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      ) : null}
      {errorMessage ? (
        <View style={[styles.feedbackCard, styles.errorCard]}>
          <Text accessibilityRole="alert" style={styles.errorText}>
            {errorMessage}
          </Text>
        </View>
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setSuccessNotice(null)}
        statusBarTranslucent
        transparent
        visible={successNotice !== null}
      >
        <View style={styles.successModalBackdrop}>
          <View
            accessibilityViewIsModal
            style={styles.successModal}
          >
            <View style={styles.successIcon}>
              <Text style={styles.successIconText}>✓</Text>
            </View>
            <Text accessibilityRole="alert" style={styles.successTitle}>
              ¡Tarea creada correctamente!
            </Text>
            <Text style={styles.successMessage}>
              {successNotice
                ? `La tarea #${successNotice.taskId} fue asignada al operador.`
                : ''}
            </Text>
            {successNotice ? (
              <Text style={styles.successDetails}>
                {successNotice.notificationCount > 0
                  ? `Se programó el aviso para ${successNotice.notificationCount} dispositivo(s).`
                  : 'El operador no tiene dispositivos registrados para recibir avisos.'}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setSuccessNotice(null)}
              style={styles.successButton}
            >
              <Text style={styles.successButtonText}>Entendido</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ModeButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.modeButton, active && styles.modeButtonActive]}
    >
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
}

function NoveltyRow({
  novelty,
  selected,
  onPress,
}: {
  novelty: AssignableNovelty;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={styles.noveltyRow}
    >
      <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
        {selected ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <View style={styles.noveltyCopy}>
        <Text style={styles.noveltyTitle}>Novedad #{novelty.id_novedad}</Text>
        <Text numberOfLines={2} style={styles.secondaryText}>
          {novelty.tipo_novedad ?? 'Novedad'} ·{' '}
          {formatNoveltyDate(novelty.fecha_novedad)}
        </Text>
      </View>
      <Text style={styles.noveltyStatus}>{novelty.estado ?? 'ABIERTA'}</Text>
    </Pressable>
  );
}

function compareNoveltyDates(
  first: AssignableNovelty,
  second: AssignableNovelty,
): number {
  const firstDate = Date.parse(first.fecha_novedad ?? '');
  const secondDate = Date.parse(second.fecha_novedad ?? '');
  const normalizedFirstDate = Number.isNaN(firstDate) ? -Infinity : firstDate;
  const normalizedSecondDate = Number.isNaN(secondDate) ? -Infinity : secondDate;

  return (
    normalizedSecondDate - normalizedFirstDate ||
    second.id_novedad - first.id_novedad
  );
}

function formatNoveltyDate(value: string | null): string {
  if (!value) return 'Fecha no disponible';

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';

  return new Intl.DateTimeFormat('es-CO').format(date);
}

function TypeOption({
  option,
  selected,
  onPress,
}: {
  option: TaskTypeOption;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.typeOption, selected && styles.typeOptionSelected]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]} />
      <Text style={[styles.typeText, selected && styles.typeTextSelected]}>
        {option.nombre}
      </Text>
    </Pressable>
  );
}

function Feedback({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.inlineFeedback}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable accessibilityRole="button" onPress={onRetry}>
        <Text style={styles.changeText}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.medium },
  card: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.large,
  },
  resultCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.medium,
  },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: typography.small,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  modeRow: { flexDirection: 'row', gap: spacing.small },
  modeButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
  },
  modeButtonActive: { backgroundColor: '#FFF1F1', borderColor: colors.primary },
  modeText: { color: colors.textSecondary, fontSize: typography.caption },
  modeTextActive: { color: colors.primary, fontWeight: '700' },
  searchInput: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 50,
    paddingHorizontal: spacing.medium,
  },
  cardTitle: { color: colors.text, fontSize: typography.heading, fontWeight: '700' },
  operatorResult: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.small,
    minHeight: 64,
    paddingVertical: spacing.small,
  },
  selectedOperator: {
    alignItems: 'center',
    backgroundColor: '#FFF8F8',
    borderRadius: radius.medium,
    flexDirection: 'row',
    gap: spacing.small,
    marginBottom: spacing.small,
    padding: spacing.small,
  },
  resultMark: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.medium,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  resultMarkText: { color: colors.primary, fontWeight: '800' },
  resultCopy: { flex: 1 },
  operatorName: { color: colors.text, fontSize: typography.caption, fontWeight: '700' },
  secondaryText: { color: colors.textSecondary, fontSize: typography.small, lineHeight: 19 },
  arrow: { color: colors.primary, fontSize: 26, paddingHorizontal: spacing.small },
  changeText: { color: colors.primary, fontSize: typography.small, fontWeight: '700' },
  noveltyList: { maxHeight: 290 },
  noveltyRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.small,
    minHeight: 62,
    paddingVertical: spacing.small,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1.5,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  checkboxSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontSize: 15, fontWeight: '800' },
  noveltyCopy: { flex: 1 },
  noveltyTitle: { color: colors.text, fontSize: typography.caption, fontWeight: '700' },
  noveltyStatus: { color: colors.success, fontSize: 10, fontWeight: '700' },
  typesList: { gap: spacing.xsmall },
  typeOption: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.small,
    minHeight: 46,
    paddingHorizontal: spacing.medium,
  },
  typeOptionSelected: { backgroundColor: '#FFF8F8', borderColor: colors.primary },
  radio: {
    borderColor: colors.textMuted,
    borderRadius: 9,
    borderWidth: 1.5,
    height: 18,
    width: 18,
  },
  radioSelected: { borderColor: colors.primary, borderWidth: 5 },
  typeText: { color: colors.text, fontSize: typography.caption },
  typeTextSelected: { color: colors.primary, fontWeight: '700' },
  descriptionInput: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.caption,
    minHeight: 110,
    padding: spacing.medium,
  },
  selectionCaption: { color: colors.textSecondary, fontSize: typography.small },
  loader: { padding: spacing.large },
  feedbackCard: {
    backgroundColor: '#EDF8F1',
    borderRadius: radius.medium,
    padding: spacing.medium,
  },
  successModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(36, 25, 25, 0.55)',
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
    backgroundColor: '#E8F5EE',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  successIconText: { color: colors.success, fontSize: 30, fontWeight: '800' },
  successTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
    textAlign: 'center',
  },
  successMessage: {
    color: colors.textSecondary,
    fontSize: typography.body,
    textAlign: 'center',
  },
  successDetails: {
    color: colors.textSecondary,
    fontSize: typography.small,
    textAlign: 'center',
  },
  successButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.medium,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: spacing.large,
    width: '100%',
  },
  successButtonText: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  feedbackText: { color: colors.text, fontSize: typography.caption, lineHeight: 20 },
  errorCard: { backgroundColor: '#FFF1F1' },
  errorText: { color: colors.danger, fontSize: typography.caption, lineHeight: 20 },
  inlineFeedback: { alignItems: 'center', flexDirection: 'row', gap: spacing.small },
});
