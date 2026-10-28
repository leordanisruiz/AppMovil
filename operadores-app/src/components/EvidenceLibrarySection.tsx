import { ActivityIndicator, Text, View } from 'react-native';
import { EvidenceGallery } from './EvidenceGallery';
import { useTareas } from '../hooks/useTareas';
import { useTareasCreadas } from '../hooks/useTareasCreadas';
import { useAuth } from '../store/AuthProvider';
import { colors } from '../theme';
import type { TaskEvidence } from '../types/tarea';

type LibraryEvidence = TaskEvidence & {
  taskId: number;
  taskLabel: string;
  taskDescription: string;
};

export function EvidenceLibrarySection({ operatorCode }: { operatorCode: string | null }) {
  const { operator } = useAuth();
  const canAssignTasks = operator?.rolId === 1 || operator?.rolId === 2;
  const assigned = useTareas(Boolean(operatorCode) && !canAssignTasks);
  const created = useTareasCreadas(canAssignTasks);
  const query = canAssignTasks ? created : assigned;
  const tasks = query.data ?? [];
  const evidenceItems = tasks.flatMap((task) => task.evidencias.map((evidence): LibraryEvidence => ({
    ...evidence,
    taskId: task.id,
    taskLabel: `Tarea #${task.id} · ${task.tipo_tarea}`,
    taskDescription: task.descripcion,
  })));

  if (query.isLoading) return <ActivityIndicator color={colors.primary} style={{ padding: 40 }} />;
  if (query.isError) return <View style={{ backgroundColor: colors.white, borderRadius: 14, padding: 22 }}><Text style={{ color: colors.text }}>No fue posible cargar las evidencias. Vuelve a intentarlo desde el módulo de tareas.</Text></View>;

  return (
    <View style={{ gap: 12 }}>
      <View><Text style={{ color: colors.text, fontSize: 18, fontWeight: '800' }}>Todas las evidencias</Text><Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{evidenceItems.length} archivos · Organizados con la tarea y su descripción</Text></View>
      <EvidenceGallery
        emptyMessage="Todavía no hay evidencias cargadas en tus tareas."
        evidences={evidenceItems}
        taskId={0}
      />
    </View>
  );
}
