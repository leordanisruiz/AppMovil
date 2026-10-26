import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { isAxiosError } from 'axios';
import {
  ActivityIndicator,
  Image,
  Modal,
  BackHandler,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { queryClient } from '../api/queryClient';
import { SectionHeading } from '../components/SectionHeading';
import { TasksSection } from '../components/TasksSection';
import { TaskAssignmentSection } from '../components/TaskAssignmentSection';
import { CreatedTasksSection } from '../components/CreatedTasksSection';
import { getApiErrorMessage } from '../services/authService';
import { useNovedades } from '../hooks/useNovedades';
import { useTareas } from '../hooks/useTareas';
import { useTareasResumen } from '../hooks/useTareasResumen';
import { useTareasCreadas } from '../hooks/useTareasCreadas';
import {
  showNewNoveltyNotification,
  subscribeToNoveltyNavigation,
  syncAppBadge,
} from '../services/notificationService';
import { registerDeviceForPushNotifications } from '../services/pushTokenService';
import type { Novedad } from '../types/novedad';
import { useAuth } from '../store/AuthProvider';
import { colors, radius, spacing, typography } from '../theme';
import { getFirstName } from '../utils/formatName';

type PortalSection =
  | 'inicio'
  | 'novedades'
  | 'tareas'
  | 'tareas-creadas'
  | 'asignacion-tareas'
  | 'mis-datos';
type WelcomeNoticeContent = {
  title: string;
  message: string;
  intro?: string;
  noveltyCount?: number;
  taskCount?: number;
};

const menuItems: {
  label: string;
  value: PortalSection;
  description: string;
  icon?: string;
}[] = [
  { label: 'Inicio', value: 'inicio', description: 'Resumen del portal' },
  { label: 'Novedades', value: 'novedades', description: 'Comunicados y avisos' },
  { label: 'Tareas', value: 'tareas', description: 'Actividades asignadas', icon: '☑' },
  {
    label: 'Tareas creadas',
    value: 'tareas-creadas',
    description: 'Seguimiento a tus asignaciones',
    icon: '▤',
  },
  {
    label: 'Asignación de tareas',
    value: 'asignacion-tareas',
    description: 'Crear actividades para operadores',
    icon: '＋',
  },
  { label: 'Mis datos', value: 'mis-datos', description: 'Perfil del operador' },
];

const sectionTitles: Record<PortalSection, string> = {
  inicio: 'Inicio',
  novedades: 'Novedades',
  tareas: 'Tareas',
  'tareas-creadas': 'Tareas creadas',
  'asignacion-tareas': 'Asignación de tareas',
  'mis-datos': 'Mis datos',
};

export function HomeScreen() {
  const { operator, logout, expireSession } = useAuth();
  const navigation = useNavigation();
  const operatorCode = operator?.codigo?.trim() || null;
  const canAssignTasks = operator?.rolId === 1 || operator?.rolId === 2;
  const canRegisterPush = Boolean(operatorCode) || canAssignTasks;
  const {
    data: novedades,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useNovedades(operatorCode);
  const tareasQuery = useTareas(Boolean(operatorCode));
  const taskCountQuery = useTareasResumen(Boolean(operatorCode));
  const notClosedTaskCount = taskCountQuery.data ?? tareasQuery.data?.filter(
    (task) => !['CERRADA', 'CERRADO'].includes(task.estado.trim().toUpperCase()),
  ).length;
  const createdTasksQuery = useTareasCreadas(canAssignTasks);
  const pendingTaskCount = tareasQuery.data?.filter(
    (task) => task.estado === 'PENDIENTE' || task.estado === 'EN_PROCESO',
  ).length ?? 0;
  const [isWelcomeNoticeDismissed, setIsWelcomeNoticeDismissed] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [pushSetupError, setPushSetupError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<PortalSection>('inicio');
  const backSwipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          gesture.x0 <= 28 && gesture.dx >= 36 && Math.abs(gesture.dy) < 55,
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dx < 92 || Math.abs(gesture.dy) > 70) return;
          if (isMenuOpen) {
            setIsMenuOpen(false);
          } else if (activeSection !== 'inicio') {
            setActiveSection('inicio');
          } else if (navigation.canGoBack()) {
            navigation.goBack();
          }
        },
      }),
    [activeSection, isMenuOpen, navigation],
  );
  const noveltySnapshot = useRef<{
    operatorCode: string;
    ids: Set<number>;
  } | null>(null);
  const firstName = operator?.nombreCompleto
    ? getFirstName(operator.nombreCompleto)
    : 'Operador';
  const welcomeNotice: WelcomeNoticeContent | null = !operatorCode
    ? {
        title: 'Bienvenido a la app de SUMA',
        message: 'Donde encontraras a la mano las soluciones necesarias.',
      }
    : !isLoading && novedades && novedades.total > 0
      ? {
          title: 'Bienvenido a la app de SUMA para Operadores',
          intro: 'Le contamos que cuenta con',
          message:
            'Por favor, acercarse a Operaciones en el horario de atención: lunes a viernes de 7:00 am a 5:00 pm. Recuerda resolver tus novedades.',
          noveltyCount: novedades.total,
          taskCount: notClosedTaskCount,
        }
      : !isLoading && novedades?.total === 0
        ? {
            title: 'Bienvenido a la app de SUMA para Operadores',
            message: 'Te felicitamos por tu buen comportamiento, no tienes novedades.',
            taskCount: notClosedTaskCount,
          }
        : null;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isMenuOpen) {
        setIsMenuOpen(false);
        return true;
      }
      if (activeSection !== 'inicio') {
        setActiveSection('inicio');
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, [activeSection, isMenuOpen]);

  useEffect(() => {
    if (!canRegisterPush) return undefined;

    let isMounted = true;
    void registerDeviceForPushNotifications()
      .then(() => {
        if (isMounted) setPushSetupError(null);
      })
      .catch(async (error: unknown) => {
        if (isAxiosError(error) && error.response?.status === 401) {
          console.warn(
            'El backend rechazó el token de sesión al registrar push; se solicitará un nuevo inicio de sesión.',
            error,
          );
          try {
            await expireSession();
          } catch (clearError) {
            console.error(
              'No se pudo limpiar por completo la sesión vencida:',
              clearError,
            );
          }
          return;
        }

        console.error('No se pudo registrar el dispositivo para push:', error);
        if (isMounted) {
          setPushSetupError(
            getApiErrorMessage(
              error,
              'No fue posible activar las notificaciones en este dispositivo.',
            ),
          );
        }
      });

    return () => {
      isMounted = false;
    };
  }, [canRegisterPush, expireSession]);


  useEffect(() => {
    if (!operatorCode || !novedades) return;

    const currentIds = new Set(
      novedades.novedades.map((novedad) => novedad.IdNovedad),
    );
    const snapshot = noveltySnapshot.current;

    if (!snapshot || snapshot.operatorCode !== operatorCode) {
      noveltySnapshot.current = { operatorCode, ids: currentIds };
      return;
    }

    const newNoveltyCount = novedades.novedades.filter(
      (novedad) => !snapshot.ids.has(novedad.IdNovedad),
    ).length;

    noveltySnapshot.current = {
      operatorCode,
      ids: new Set([...snapshot.ids, ...currentIds]),
    };

    if (newNoveltyCount > 0) {
      void showNewNoveltyNotification(newNoveltyCount).catch(
        (error: unknown) => {
          console.error('No se pudo mostrar el aviso de nuevas novedades:', error);
        },
      );
    }
  }, [novedades, operatorCode]);


  useEffect(() => {
    if (!operatorCode) return;

    const pendingCount =
      pendingTaskCount + (novedades?.total ?? 0);

    void syncAppBadge(pendingCount).catch((error: unknown) => {
      console.error('No se pudo actualizar el contador del icono:', error);
    });
  }, [novedades?.total, operatorCode, pendingTaskCount]);


  useEffect(() => {
    const openNovedades = () => {
      setActiveSection('novedades');
      setIsMenuOpen(false);
    };
    const refreshHomeData = () => {
      if (operatorCode) {
        void queryClient.invalidateQueries({
          queryKey: ['novedades', operatorCode],
        });
      }
      void queryClient.invalidateQueries({ queryKey: ['tareas'] });
      void queryClient.invalidateQueries({ queryKey: ['tareas-creadas'] });
    };
    const openTasks = () => {
      setActiveSection('tareas');
      setIsMenuOpen(false);
    };
    return subscribeToNoveltyNavigation(
      openNovedades,
      refreshHomeData,
      openTasks,
    );
  }, [operatorCode]);

  const handleLogout = async () => {
    setLogoutError(null);

    try {
      await logout();
    } catch {
      setLogoutError('No fue posible cerrar sesión. Inténtalo nuevamente.');
    }
  };

  const selectSection = (section: PortalSection) => {
    setActiveSection(section);
    setIsMenuOpen(false);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View style={styles.appShell} {...backSwipe.panHandlers}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {pushSetupError ? (
            <Text accessibilityRole="alert" style={styles.pushSetupError}>
              {pushSetupError}
            </Text>
          ) : null}
          <View style={styles.topBar}>
            <Pressable
              accessibilityLabel="Abrir menú de navegación"
              accessibilityRole="button"
              onPress={() => {
                if (Platform.OS === 'web') setIsWelcomeNoticeDismissed(true);
                setIsMenuOpen(true);
              }}
              style={styles.menuButton}
            >
              <Text style={styles.menuButtonText}>☰</Text>
            </Pressable>

            <View style={styles.brandLockup}>
              <Image
                accessibilityLabel="Logo corporativo"
                resizeMode="contain"
                source={require('../../assets/brand-symbol.png')}
                style={styles.brandLogo}
              />
              <View>
                <Text style={styles.brandName}>Portal Operadores</Text>
                <Text style={styles.brandCaption}>SUMA · OPERACIÓN</Text>
              </View>
            </View>

          </View>

          <View style={styles.pageHeading}>
            <Text style={styles.pageEyebrow}>PORTAL DEL OPERADOR</Text>
            <Text style={styles.pageTitle}>{sectionTitles[activeSection]}</Text>
          </View>

          <Modal
            animationType="fade"
            onRequestClose={() => setIsWelcomeNoticeDismissed(true)}
            statusBarTranslucent
            transparent
            visible={welcomeNotice !== null && !isWelcomeNoticeDismissed}
          >
            <View style={styles.welcomeModalBackdrop}>
              <View style={styles.welcomeNotice}>
                <View style={styles.welcomeNoticeAccent} />
                <View style={styles.welcomeNoticeHeader}>
                  <View style={styles.welcomeNoticeIcon}>
                    <Text style={styles.welcomeNoticeIconText}>!</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Cerrar mensaje de bienvenida"
                    accessibilityRole="button"
                    onPress={() => setIsWelcomeNoticeDismissed(true)}
                    style={styles.welcomeNoticeClose}
                  >
                    <Text style={styles.welcomeNoticeCloseText}>×</Text>
                  </Pressable>
                </View>
                <Text style={styles.welcomeNoticeEyebrow}>MENSAJE DE BIENVENIDA</Text>
                <Text style={styles.welcomeNoticeTitle}>{welcomeNotice?.title}</Text>
                {welcomeNotice?.intro ? (
                  <Text style={styles.welcomeNoticeText}>{welcomeNotice.intro}</Text>
                ) : null}
                {welcomeNotice?.noveltyCount !== undefined ||
                welcomeNotice?.taskCount !== undefined ? (
                  <View style={styles.welcomeNoticeCounts}>
                    {welcomeNotice.noveltyCount !== undefined ? (
                      <View style={styles.welcomeNoticeCount}>
                        <Text style={styles.welcomeNoticeCountNumber}>
                          {welcomeNotice.noveltyCount}
                        </Text>
                        <Text style={styles.welcomeNoticeCountLabel}>
                          novedades abiertas
                        </Text>
                      </View>
                    ) : null}
                    {welcomeNotice.taskCount !== undefined ? (
                      <View style={styles.welcomeNoticeCount}>
                        <Text style={styles.welcomeNoticeCountNumber}>
                          {welcomeNotice.taskCount}
                        </Text>
                        <Text style={styles.welcomeNoticeCountLabel}>
                          {welcomeNotice.taskCount === 1
                            ? 'Tarea asignada'
                            : 'Tareas asignadas'}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                <Text style={styles.welcomeNoticeText}>
                  {welcomeNotice?.message}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setIsWelcomeNoticeDismissed(true)}
                  style={styles.welcomeNoticeButton}
                >
                  <Text style={styles.welcomeNoticeButtonText}>
                    Entendido, continuar
                  </Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {activeSection === 'inicio' ? (
            <View style={styles.sectionContent}>
              <View style={styles.welcomeCard}>
                <View style={styles.welcomeAccent} />
                <Text style={styles.welcomeEyebrow}>BIENVENIDO</Text>
                <Text style={styles.welcomeTitle}>Hola, {firstName}</Text>
                <Text style={styles.welcomeCopy}>
                  Tu información y las novedades de la operación, siempre a la mano.
                </Text>
                <View style={styles.operatorBadge}>
                  <Text style={styles.operatorBadgeText}>
                    IDENTIFICACIÓN  ·  {operator?.identificacion ?? '—'}
                  </Text>
                </View>
              </View>

              <SectionHeading
                title="Resumen de operación"
                supportingText="Consulta rápidamente tu información más importante."
              />
              <View style={styles.summaryRow}>
                {canAssignTasks ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => selectSection('tareas-creadas')}
                    style={styles.summaryCard}
                  >
                    <View style={styles.summaryIcon}>
                      <Text style={styles.summaryIconText}>▤</Text>
                    </View>
                    <Text style={styles.summaryLabel}>Tareas creadas</Text>
                    <Text style={styles.summaryValue}>
                      {createdTasksQuery.data?.length ?? '—'}
                    </Text>
                    <Text style={styles.summaryFootnote}>
                      Seguimiento de asignaciones
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => selectSection('tareas')}
                      style={styles.summaryCard}
                    >
                      <View style={styles.summaryIcon}>
                        <Text style={styles.summaryIconText}>☑</Text>
                      </View>
                      <Text style={styles.summaryLabel}>Tareas</Text>
                      <Text style={styles.summaryValue}>
                        {tareasQuery.isLoading ? '—' : pendingTaskCount}
                      </Text>
                      <Text style={styles.summaryFootnote}>
                        Actividades asignadas
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => selectSection('novedades')}
                      style={styles.summaryCard}
                    >
                      <View style={styles.summaryIcon}>
                        <Text style={styles.summaryIconText}>↗</Text>
                      </View>
                      <Text style={styles.summaryLabel}>Novedades</Text>
                      <Text style={styles.summaryValue}>
                        {novedades?.total ?? '—'}
                      </Text>
                      <Text style={styles.summaryFootnote}>
                        Ver todos los avisos
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => selectSection('mis-datos')}
                style={styles.profileShortcut}
              >
                <View style={styles.profileShortcutMark}>
                  <Text style={styles.profileShortcutInitial}>
                    {firstName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.profileShortcutCopy}>
                  <Text style={styles.profileShortcutTitle}>
                    {operator?.nombreCompleto ?? 'Consulta tus datos'}
                  </Text>
                  <Text style={styles.profileShortcutCaption}>
                    Revisar información del perfil
                  </Text>
                </View>
                <Text style={styles.profileShortcutArrow}>›</Text>
              </Pressable>
            </View>
          ) : null}

          {activeSection === 'novedades' ? (
            <View style={styles.sectionContent}>
              <SectionHeading
                title="Comunicados para ti"
                supportingText="Información importante para tu operación."
              />
              <View style={styles.newsOverview}>
                <View>
                  <Text style={styles.newsOverviewLabel}>NOVEDADES ABIERTAS</Text>
                  <Text style={styles.newsOverviewCount}>
                    {novedades?.total ?? '—'}
                  </Text>
                </View>
              </View>

              {!operatorCode ? (
                <NovedadesNoAplica />
              ) : isLoading ? (
                <ActivityIndicator color={colors.primary} style={styles.feedback} />
              ) : isError ? (
                <View style={styles.feedbackCard}>
                  <Text style={styles.feedbackText}>
                    No fue posible cargar las novedades.
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => void refetch()}>
                    <Text style={styles.retryText}>Reintentar</Text>
                  </Pressable>
                </View>
              ) : novedades?.novedades.length ? (
                <NovedadesTable rows={novedades.novedades} />
              ) : (
                <View style={styles.feedbackCard}>
                  <Text style={styles.emptyTitle}>Todo al día</Text>
                  <Text style={styles.feedbackText}>
                    No tienes novedades abiertas para consultar.
                  </Text>
                </View>
              )}
              {isRefetching ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
          ) : null}

          {activeSection === 'mis-datos' ? (
            <View style={styles.sectionContent}>
              <View style={styles.profileHero}>
                <View style={styles.profileAvatar}>
                  <Text style={styles.profileAvatarInitial}>
                    {firstName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.profileHeroName}>
                  {operator?.nombreCompleto ?? 'Operador'}
                </Text>
                <Text style={styles.profileHeroRole}>
                  {operator?.cargo ?? 'Cargo no disponible'}
                </Text>
              </View>
              <View style={styles.profileCard}>
                <SectionHeading
                  title="Información personal"
                  supportingText="Datos asociados a tu perfil corporativo."
                />
                <ProfileRow label="Código" value={operator?.codigo ?? '—'} />
                <ProfileRow
                  label="Tipo de documento"
                  value={operator?.tipoDocumento ?? '—'}
                />
                <ProfileRow
                  label="Identificación"
                  value={operator?.identificacion ?? '—'}
                />
                <ProfileRow
                  label="Nombre completo"
                  value={operator?.nombreCompleto ?? '—'}
                />
                <ProfileRow
                  label="Fecha de ingreso"
                  value={operator?.fechaIngreso ?? '—'}
                />
                <ProfileRow label="Cargo" value={operator?.cargo ?? '—'} />
                <View style={styles.profileRow}>
                  <Text style={styles.profileLabel}>Estado del empleado</Text>
                  <Text
                    style={[
                      styles.profileValue,
                      operator?.estadoEmpleado === 'A'
                        ? styles.profileStatus
                        : styles.profileInactiveStatus,
                    ]}
                  >
                    {operator?.estadoEmpleado === 'A'
                      ? 'Activo (A)'
                      : `${operator?.estadoEmpleado ?? '—'}`}
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {activeSection === 'tareas' && !canAssignTasks ? (
            <TasksSection operatorCode={operatorCode} />
          ) : null}
          {activeSection === 'tareas-creadas' && canAssignTasks ? (
            <CreatedTasksSection />
          ) : null}
          {activeSection === 'asignacion-tareas' && canAssignTasks ? (
            <TaskAssignmentSection />
          ) : null}

          {logoutError ? <Text style={styles.logoutError}>{logoutError}</Text> : null}
          <Text style={styles.footer}>Portal Operadores · Uso corporativo</Text>
        </ScrollView>

        {isMenuOpen ? (
          <>
            <Pressable
              accessibilityLabel="Cerrar menú"
              accessibilityRole="button"
              onPress={() => setIsMenuOpen(false)}
              style={styles.backdrop}
            />
            <ScrollView
              style={[
                styles.sidebar,
                Platform.OS === 'web' && styles.sidebarWeb,
              ]}
              contentContainerStyle={styles.sidebarContent}
              showsVerticalScrollIndicator={Platform.OS === 'web'}
            >
              <View style={styles.sidebarHeader}>
                <Image
                  accessibilityLabel="Logo corporativo"
                  resizeMode="contain"
                  source={require('../../assets/brand-logo.png')}
                  style={styles.sidebarLogo}
                />
                <View>
                  <Text style={styles.sidebarTitle}>Portal Operadores</Text>
                  <Text style={styles.sidebarCaption}>MENÚ PRINCIPAL</Text>
                </View>
              </View>

              <Text style={styles.menuSectionLabel}>NAVEGACIÓN</Text>
              {menuItems
                .filter(
                  (item) =>
                    (item.value !== 'asignacion-tareas' || canAssignTasks) &&
                    (item.value !== 'tareas' || !canAssignTasks) &&
                    (item.value !== 'tareas-creadas' || canAssignTasks),
                )
                .map((item) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: activeSection === item.value }}
                  key={item.value}
                  onPress={() => selectSection(item.value)}
                  style={[
                    styles.menuItem,
                    activeSection === item.value && styles.menuItemActive,
                  ]}
                >
                  <View style={styles.menuItemCopy}>
                    <View style={styles.menuItemTitleRow}>
                      {item.icon ? (
                        <Text
                          style={[
                            styles.menuItemIcon,
                            activeSection === item.value && styles.menuItemTextActive,
                          ]}
                        >
                          {item.icon}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.menuItemText,
                          activeSection === item.value && styles.menuItemTextActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                    </View>
                    <Text style={styles.menuItemDescription}>{item.description}</Text>
                  </View>
                  {(item.value === 'novedades' && novedades?.total) ||
                  (item.value === 'tareas' && pendingTaskCount) ? (
                    <View style={styles.menuBadge}>
                      <Text style={styles.menuBadgeText}>
                        {item.value === 'novedades'
                          ? novedades?.total
                          : pendingTaskCount}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
                ))}

              <View style={styles.sidebarOperator}>
                <View style={styles.sidebarAvatar}>
                  <Text style={styles.sidebarAvatarInitial}>
                    {firstName.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.sidebarOperatorCopy}>
                  <Text numberOfLines={1} style={styles.sidebarOperatorName}>
                    {operator?.nombreCompleto ?? 'Operador'}
                  </Text>
                  <Text style={styles.sidebarOperatorCaption}>Sesión activa</Text>
                </View>
              </View>
              <Pressable
                accessibilityLabel="Cerrar sesion"
                accessibilityRole="button"
                onPress={handleLogout}
                style={styles.sidebarLogout}
              >
                <View style={styles.sidebarLogoutIconCircle}>
                  <View style={styles.sidebarLogoutDoor} />
                  <View style={styles.sidebarLogoutArrowStem} />
                  <View style={styles.sidebarLogoutArrowHeadTop} />
                  <View style={styles.sidebarLogoutArrowHeadBottom} />
                </View>
                <Text style={styles.sidebarLogoutText}>Cerrar sesión</Text>
              </Pressable>
            </ScrollView>
          </>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <Text style={styles.profileLabel}>{label}</Text>
      <Text style={styles.profileValue}>{value}</Text>
    </View>
  );
}

function NovedadesTable({ rows }: { rows: Novedad[] }) {
  const pageSize = 5;
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedNovelty, setSelectedNovelty] = useState<Novedad | null>(null);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(currentPage, pageCount);
  const startIndex = (page - 1) * pageSize;
  const pageRows = rows.slice(startIndex, startIndex + pageSize);

  return (
    <View style={styles.tableCard}>
      <View style={styles.tableContainer}>
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.tableHeaderCell, styles.idColumn]}>ID</Text>
          <Text style={[styles.tableHeaderCell, styles.dateColumn]}>Fecha</Text>
          <Text style={[styles.tableHeaderCell, styles.statusColumn]}>Estado</Text>
        </View>
        {pageRows.map((novedad, index) => {
          const status = novedad.Estado?.trim() || 'Sin estado';
          const isOpenStatus = /^(ABIERTO|ABIERTA|EN PROCESO|PROCESO)$/i.test(status);

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Ver detalle de la novedad ${novedad.IdNovedad}`}
              key={novedad.IdNovedad}
              onPress={() => setSelectedNovelty(novedad)}
              style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlternate]}
            >
              <Text style={[styles.tableCell, styles.idColumn, styles.idCell]}>
                {novedad.IdNovedad}
              </Text>
              <Text style={[styles.tableCell, styles.dateColumn]}>
                {formatNoveltyDate(novedad.FechaNovedad)}
              </Text>
              <View style={[styles.statusColumn, styles.statusCell]}>
                <View
                  style={[
                    styles.statusPill,
                    isOpenStatus && styles.statusPillOpen,
                  ]}
                >
                  <View
                    style={[styles.statusDot, isOpenStatus && styles.statusDotOpen]}
                  />
                  <Text
                    numberOfLines={1}
                    style={[styles.statusText, isOpenStatus && styles.statusTextOpen]}
                  >
                    {status}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
        <View style={styles.pagination}>
          <Text style={styles.paginationSummary}>
            {startIndex + 1}–{Math.min(startIndex + pageSize, rows.length)} de {rows.length}
          </Text>
          <View style={styles.paginationControls}>
            <Pressable
              accessibilityLabel="Página anterior"
              accessibilityRole="button"
              accessibilityState={{ disabled: page <= 1 }}
              disabled={page <= 1}
              onPress={() => setCurrentPage(page - 1)}
              style={[styles.paginationButton, page <= 1 && styles.paginationButtonDisabled]}
            >
              <Text
                style={[
                  styles.paginationButtonText,
                  page <= 1 && styles.paginationButtonTextDisabled,
                ]}
              >
                ‹
              </Text>
            </Pressable>
            <Text style={styles.paginationPage}>
              {page} / {pageCount}
            </Text>
            <Pressable
              accessibilityLabel="Página siguiente"
              accessibilityRole="button"
              accessibilityState={{ disabled: page >= pageCount }}
              disabled={page >= pageCount}
              onPress={() => setCurrentPage(page + 1)}
              style={[
                styles.paginationButton,
                page >= pageCount && styles.paginationButtonDisabled,
              ]}
            >
              <Text
                style={[
                  styles.paginationButtonText,
                  page >= pageCount && styles.paginationButtonTextDisabled,
                ]}
              >
                ›
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
      <Modal
        animationType="slide"
        onRequestClose={() => setSelectedNovelty(null)}
        transparent
        visible={selectedNovelty !== null}
      >
        <View style={styles.noveltyModalBackdrop}>
          <Pressable
            accessibilityLabel="Cerrar detalle de novedad"
            accessibilityRole="button"
            onPress={() => setSelectedNovelty(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.noveltyModalCard}>
            <View style={styles.noveltyModalHandle} />
            <Text style={styles.noveltyModalTitle}>Detalle de novedad</Text>
            <ScrollView contentContainerStyle={styles.noveltyModalContent}>
              {selectedNovelty ? (
                <>
                  <NoveltyDetail label="ID Novedad" value={String(selectedNovelty.IdNovedad)} />
                  <NoveltyDetail label="Fecha Novedad" value={formatNoveltyDate(selectedNovelty.FechaNovedad)} />
                  <NoveltyDetail label="Estado" value={selectedNovelty.Estado} />
                  <NoveltyDetail label="Tipo Novedad" value={selectedNovelty.TipoNovedad} />
                  <NoveltyDetail label="Grupo" value={selectedNovelty.Grupo} />
                  <NoveltyDetail label="Subgrupo" value={selectedNovelty.Subgrupo} />
                  <NoveltyDetail label="Novedad" value={selectedNovelty.Novedad} />
                  <NoveltyDetail label="Descripción" value={selectedNovelty.Descripcion} />
                </>
              ) : null}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelectedNovelty(null)}
              style={styles.noveltyModalClose}
            >
              <Text style={styles.noveltyModalCloseText}>Cerrar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function NoveltyDetail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.noveltyDetailItem}>
      <Text style={styles.noveltyDetailLabel}>{label}</Text>
      <Text style={styles.noveltyDetailValue}>{value?.trim() || 'Sin información'}</Text>
    </View>
  );
}

function formatNoveltyDate(value: string | null): string {
  if (!value) return '—';

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (isoDate) {
    return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function NovedadesNoAplica() {
  return (
    <View style={styles.feedbackCard}>
      <Text style={styles.emptyTitle}>Novedades no disponibles</Text>
      <Text style={styles.feedbackText}>
        Este perfil no tiene un código de operador asociado. No se realiza la
        consulta de novedades para este usuario.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  appShell: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: spacing.large,
    paddingBottom: spacing.xxlarge,
    paddingHorizontal: spacing.large,
    paddingTop: spacing.medium,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  menuButton: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  menuButtonText: {
    color: colors.navy,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  brandLockup: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.small,
    justifyContent: 'center',
    marginHorizontal: spacing.xsmall,
  },
  brandLogo: {
    borderRadius: radius.small,
    height: 38,
    width: 38,
  },
  brandName: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  brandCaption: {
    color: colors.textMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  pageHeading: {
    gap: spacing.xsmall,
    marginTop: spacing.small,
  },
  pageEyebrow: {
    color: colors.primary,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  pageTitle: {
    color: colors.text,
    fontSize: typography.display,
    fontWeight: '800',
  },
  welcomeNotice: {
    backgroundColor: colors.white,
    borderRadius: 18,
    gap: spacing.medium,
    overflow: 'hidden',
    padding: spacing.large,
    width: '100%',
    maxWidth: 380,
    elevation: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
  },
  welcomeModalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(36, 25, 25, 0.68)',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.medium,
  },
  welcomeNoticeAccent: {
    backgroundColor: colors.primary,
    height: 6,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  welcomeNoticeHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  welcomeNoticeIcon: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  welcomeNoticeIconText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  welcomeNoticeEyebrow: {
    color: colors.primary,
    fontSize: typography.overline,
    fontWeight: '800',
    letterSpacing: 1.1,
  },
  welcomeNoticeTitle: {
    color: '#241F20',
    fontSize: 17,
    fontWeight: '800',
    lineHeight: 23,
  },
  welcomeNoticeClose: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  welcomeNoticeCloseText: {
    color: '#A18E8E',
    fontSize: 24,
    lineHeight: 28,
  },
  welcomeNoticeCounts: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.small,
  },
  welcomeNoticeCount: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderColor: '#FFD5D5',
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.small,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  welcomeNoticeCountNumber: {
    color: colors.primary,
    fontSize: typography.heading,
    fontWeight: '900',
  },
  welcomeNoticeCountLabel: {
    color: '#271F1F',
    fontSize: typography.small,
    fontWeight: '700',
  },
  welcomeNoticeText: {
    color: '#706565',
    fontSize: typography.small,
    lineHeight: 20,
  },
  welcomeNoticeButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.medium,
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.xsmall,
  },
  welcomeNoticeButtonText: {
    color: colors.white,
    fontSize: typography.small,
    fontWeight: '800',
  },
  sectionContent: {
    gap: spacing.large,
  },
  welcomeCard: {
    backgroundColor: colors.navy,
    borderRadius: radius.large,
    gap: spacing.small,
    overflow: 'hidden',
    padding: spacing.large,
  },
  welcomeAccent: {
    backgroundColor: colors.primary,
    borderBottomLeftRadius: radius.medium,
    borderTopLeftRadius: radius.medium,
    bottom: spacing.large,
    position: 'absolute',
    right: 0,
    top: spacing.large,
    width: 5,
  },
  welcomeEyebrow: {
    color: colors.accentLight,
    fontSize: typography.overline,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  welcomeTitle: {
    color: colors.white,
    fontSize: typography.display,
    fontWeight: '800',
  },
  welcomeCopy: {
    color: colors.whiteMuted,
    fontSize: typography.caption,
    lineHeight: 21,
    maxWidth: 290,
  },
  operatorBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.navyLight,
    borderRadius: radius.pill,
    marginTop: spacing.small,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.xsmall,
  },
  operatorBadgeText: {
    color: colors.white,
    fontSize: typography.overline,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.medium,
  },
  summaryCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    flex: 1,
    gap: spacing.xsmall,
    minHeight: 150,
    padding: spacing.medium,
  },
  summaryIcon: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.small,
    height: 32,
    justifyContent: 'center',
    marginBottom: spacing.xsmall,
    width: 32,
  },
  summaryIconText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  summaryLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  summaryValue: {
    color: colors.text,
    fontSize: typography.display,
    fontWeight: '800',
  },
  summaryFootnote: {
    color: colors.textMuted,
    fontSize: typography.small,
  },
  profileShortcut: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.medium,
    padding: spacing.medium,
  },
  profileShortcutMark: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  profileShortcutInitial: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '800',
  },
  profileShortcutCopy: {
    flex: 1,
    gap: spacing.xsmall,
  },
  profileShortcutTitle: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  profileShortcutCaption: {
    color: colors.textSecondary,
    fontSize: typography.small,
  },
  profileShortcutArrow: {
    color: colors.primary,
    fontSize: 28,
  },
  newsOverview: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: radius.medium,
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.medium,
  },
  newsOverviewLabel: {
    color: colors.whiteMuted,
    fontSize: typography.overline,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  newsOverviewCount: {
    color: colors.white,
    fontSize: typography.heading,
    fontWeight: '800',
    marginTop: spacing.xsmall,
  },
  feedback: {
    padding: spacing.large,
  },
  feedbackCard: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.large,
  },
  feedbackText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  retryText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  tableCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    overflow: 'hidden',
  },
  noveltyModalBackdrop: {
    backgroundColor: 'rgba(16, 22, 30, 0.5)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  noveltyModalCard: {
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.large,
    borderTopRightRadius: radius.large,
    maxHeight: '82%',
    padding: spacing.large,
  },
  noveltyModalHandle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: radius.pill,
    height: 4,
    marginBottom: spacing.medium,
    width: 42,
  },
  noveltyModalTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '800',
    marginBottom: spacing.medium,
  },
  noveltyModalContent: {
    gap: spacing.medium,
    paddingBottom: spacing.medium,
  },
  noveltyDetailItem: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: spacing.xsmall,
    paddingBottom: spacing.small,
  },
  noveltyDetailLabel: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: '700',
  },
  noveltyDetailValue: {
    color: colors.text,
    fontSize: typography.caption,
    lineHeight: 21,
  },
  noveltyModalClose: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.medium,
    justifyContent: 'center',
    marginTop: spacing.medium,
    minHeight: 48,
  },
  noveltyModalCloseText: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  tableContainer: {
    padding: spacing.medium,
  },
  tableHeaderRow: {
    backgroundColor: '#FFF0F0',
    borderRadius: radius.medium,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  tableHeaderCell: {
    color: colors.primary,
    fontSize: typography.small,
    fontWeight: '800',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.small,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    minHeight: 54,
  },
  tableRowAlternate: {
    backgroundColor: '#FFFAFA',
  },
  tableCell: {
    color: colors.text,
    fontSize: typography.small,
    lineHeight: 18,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.medium,
  },
  idCell: {
    fontWeight: '700',
  },
  idColumn: {
    flex: 0.9,
    minWidth: 68,
  },
  dateColumn: {
    flex: 1,
    minWidth: 78,
  },
  statusColumn: {
    flex: 1.1,
    minWidth: 90,
  },
  statusCell: {
    alignItems: 'center',
    paddingHorizontal: spacing.small,
  },
  statusPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.pill,
    flexDirection: 'row',
    gap: spacing.xsmall,
    maxWidth: '100%',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  statusPillOpen: {
    backgroundColor: '#E8F5EC',
  },
  statusDot: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 7,
    width: 7,
  },
  statusDotOpen: {
    backgroundColor: colors.success,
  },
  statusText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  statusTextOpen: {
    color: colors.success,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xsmall,
    paddingTop: spacing.medium,
  },
  paginationSummary: {
    color: colors.textSecondary,
    fontSize: typography.small,
  },
  paginationControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.small,
  },
  paginationButton: {
    alignItems: 'center',
    backgroundColor: '#FFF0F0',
    borderRadius: radius.small,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  paginationButtonDisabled: {
    backgroundColor: '#F5F1F1',
  },
  paginationButtonText: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 28,
  },
  paginationButtonTextDisabled: {
    color: colors.textMuted,
  },
  paginationPage: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: '700',
  },
  profileHero: {
    alignItems: 'center',
    backgroundColor: colors.navy,
    borderRadius: radius.large,
    gap: spacing.small,
    padding: spacing.large,
  },
  profileAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderColor: colors.white,
    borderRadius: radius.pill,
    borderWidth: 3,
    height: 72,
    justifyContent: 'center',
    marginBottom: spacing.small,
    width: 72,
  },
  profileAvatarInitial: {
    color: colors.white,
    fontSize: typography.display,
    fontWeight: '800',
  },
  profileHeroName: {
    color: colors.white,
    fontSize: typography.body,
    fontWeight: '800',
    textAlign: 'center',
  },
  profileHeroRole: {
    color: colors.whiteMuted,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  profileCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.medium,
  },
  profileRow: {
    alignItems: 'flex-start',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.medium,
  },
  profileLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  profileValue: {
    color: colors.text,
    flex: 1,
    fontSize: typography.caption,
    fontWeight: '600',
    marginLeft: spacing.medium,
    textAlign: 'right',
  },
  profileStatus: {
    color: colors.success,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  profileInactiveStatus: {
    color: colors.danger,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  logoutError: {
    color: colors.danger,
    fontSize: typography.caption,
    textAlign: 'center',
  },
  pushSetupError: {
    backgroundColor: '#FFF0F0',
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    color: colors.danger,
    fontSize: typography.small,
    padding: spacing.medium,
  },
  footer: {
    color: colors.textMuted,
    fontSize: typography.small,
    textAlign: 'center',
  },
  backdrop: {
    backgroundColor: 'rgba(28, 8, 8, 0.48)',
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 1,
  },
  sidebar: {
    backgroundColor: colors.navy,
    bottom: 0,
    elevation: 8,
    left: 0,
    position: 'absolute',
    top: 0,
    width: 292,
    zIndex: 2,
  },
  sidebarWeb: {
    maxHeight: '100%',
    overflow: 'scroll',
  },
  sidebarContent: {
    flexGrow: 1,
    paddingBottom: spacing.large,
    paddingHorizontal: spacing.large,
    paddingTop: spacing.large,
  },
  sidebarHeader: {
    alignItems: 'center',
    borderBottomColor: colors.navyLight,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.medium,
    marginBottom: spacing.large,
    paddingBottom: spacing.large,
  },
  sidebarLogo: {
    borderRadius: radius.small,
    height: 48,
    width: 48,
  },
  sidebarTitle: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  sidebarCaption: {
    color: colors.whiteMuted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: spacing.xsmall,
  },
  menuSectionLabel: {
    color: colors.whiteMuted,
    fontSize: typography.overline,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: spacing.small,
  },
  menuItem: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.small,
    minHeight: 64,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
  },
  menuItemActive: {
    backgroundColor: colors.navyLight,
    borderColor: colors.primary,
  },
  menuItemCopy: {
    flex: 1,
    gap: spacing.xsmall,
  },
  menuItemTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xsmall,
  },
  menuItemIcon: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  menuItemText: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  menuItemTextActive: {
    color: colors.accentLight,
  },
  menuItemDescription: {
    color: colors.whiteMuted,
    fontSize: typography.small,
  },
  menuBadge: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    justifyContent: 'center',
    minWidth: 26,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.xsmall,
  },
  menuBadgeText: {
    color: colors.white,
    fontSize: typography.small,
    fontWeight: '800',
  },
  sidebarOperator: {
    alignItems: 'center',
    borderTopColor: colors.navyLight,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.small,
    marginTop: 'auto',
    paddingTop: spacing.medium,
  },
  sidebarAvatar: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  sidebarAvatarInitial: {
    color: colors.white,
    fontSize: typography.caption,
    fontWeight: '800',
  },
  sidebarOperatorCopy: {
    flex: 1,
    gap: spacing.xsmall,
  },
  sidebarOperatorName: {
    color: colors.white,
    fontSize: typography.small,
    fontWeight: '700',
  },
  sidebarOperatorCaption: {
    color: colors.whiteMuted,
    fontSize: typography.small,
  },
  sidebarLogout: {
    alignItems: 'center',
    borderTopColor: colors.navyLight,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.small,
    marginTop: spacing.medium,
    paddingVertical: spacing.medium,
  },
  sidebarLogoutIconCircle: {
    backgroundColor: colors.navyLight,
    borderRadius: radius.small,
    height: 34,
    position: 'relative',
    width: 34,
  },
  sidebarLogoutDoor: {
    borderBottomColor: colors.accentLight,
    borderBottomWidth: 2,
    borderLeftColor: colors.accentLight,
    borderLeftWidth: 2,
    borderTopColor: colors.accentLight,
    borderTopWidth: 2,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
    height: 18,
    left: 7,
    position: 'absolute',
    top: 8,
    width: 12,
  },
  sidebarLogoutArrowStem: {
    backgroundColor: colors.accentLight,
    height: 2,
    left: 12,
    position: 'absolute',
    top: 16,
    width: 14,
  },
  sidebarLogoutArrowHeadTop: {
    backgroundColor: colors.accentLight,
    height: 2,
    left: 21,
    position: 'absolute',
    top: 12,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  sidebarLogoutArrowHeadBottom: {
    backgroundColor: colors.accentLight,
    height: 2,
    left: 21,
    position: 'absolute',
    top: 19,
    transform: [{ rotate: '-45deg' }],
    width: 8,
  },
  sidebarLogoutText: {
    color: colors.accentLight,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
