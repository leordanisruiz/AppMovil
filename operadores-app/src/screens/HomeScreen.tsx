import { useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { queryClient } from '../api/queryClient';
import { SectionHeading } from '../components/SectionHeading';
import { getApiErrorMessage } from '../services/authService';
import { useNovedades } from '../hooks/useNovedades';
import {
  showNewNoveltyNotification,
  subscribeToNoveltyNavigation,
} from '../services/notificationService';
import { registerDeviceForPushNotifications } from '../services/pushTokenService';
import type { Novedad } from '../types/novedad';
import { useAuth } from '../store/AuthProvider';
import { colors, radius, spacing, typography } from '../theme';
import { getFirstName } from '../utils/formatName';

type PortalSection = 'inicio' | 'novedades' | 'pendientes' | 'mis-datos';

const menuItems: {
  label: string;
  value: PortalSection;
  description: string;
}[] = [
  { label: 'Inicio', value: 'inicio', description: 'Resumen del portal' },
  { label: 'Novedades', value: 'novedades', description: 'Comunicados y avisos' },
  { label: 'Pendientes', value: 'pendientes', description: 'Novedades abiertas' },
  { label: 'Mis datos', value: 'mis-datos', description: 'Perfil del operador' },
];

const sectionTitles: Record<PortalSection, string> = {
  inicio: 'Inicio',
  novedades: 'Novedades',
  pendientes: 'Pendientes',
  'mis-datos': 'Mis datos',
};

export function HomeScreen() {
  const { operator, logout, expireSession } = useAuth();
  const operatorCode = operator?.codigo?.trim() || null;
  const {
    data: novedades,
    isLoading,
    isError,
    refetch,
    isRefetching,
  } = useNovedades(operatorCode);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [pushSetupError, setPushSetupError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<PortalSection>('inicio');
  const noveltySnapshot = useRef<{
    operatorCode: string;
    ids: Set<number>;
  } | null>(null);
  const firstName = operator?.nombreCompleto
    ? getFirstName(operator.nombreCompleto)
    : 'Operador';

  useEffect(() => {
    if (!operatorCode) return undefined;

    let isMounted = true;
    void registerDeviceForPushNotifications(operatorCode)
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
  }, [expireSession, operatorCode]);

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
    const openNovedades = () => {
      setActiveSection('novedades');
      setIsMenuOpen(false);
    };
    const refreshNovedades = () => {
      if (operatorCode) {
        void queryClient.invalidateQueries({
          queryKey: ['novedades', operatorCode],
        });
      }
    };
    return subscribeToNoveltyNavigation(openNovedades, refreshNovedades);
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
      <View style={styles.appShell}>
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
              onPress={() => setIsMenuOpen(true)}
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

            <Pressable
              accessibilityRole="button"
              onPress={handleLogout}
              style={styles.logoutButton}
            >
              <Text style={styles.logoutText}>Salir</Text>
            </Pressable>
          </View>

          <View style={styles.pageHeading}>
            <Text style={styles.pageEyebrow}>PORTAL DEL OPERADOR</Text>
            <Text style={styles.pageTitle}>{sectionTitles[activeSection]}</Text>
          </View>

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
                <Pressable
                  accessibilityRole="button"
                  onPress={() => selectSection('pendientes')}
                  style={styles.summaryCard}
                >
                  <View style={styles.summaryIcon}>
                    <Text style={styles.summaryIconText}>!</Text>
                  </View>
                  <Text style={styles.summaryLabel}>Pendientes</Text>
                  <Text style={styles.summaryValue}>
                    {novedades?.total ?? '—'}
                  </Text>
                  <Text style={styles.summaryFootnote}>Novedades abiertas</Text>
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
                  <Text style={styles.summaryValue}>{novedades?.total ?? '—'}</Text>
                  <Text style={styles.summaryFootnote}>Ver todos los avisos</Text>
                </Pressable>
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

          {activeSection === 'pendientes' ? (
            <View style={styles.sectionContent}>
              <SectionHeading
                title="Novedades pendientes"
                supportingText="Aquí se muestran las novedades abiertas reportadas para tu código de operador."
              />
              <View style={styles.newsOverview}>
                <View>
                  <Text style={styles.newsOverviewLabel}>TOTAL ABIERTO</Text>
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
                    No fue posible cargar las novedades pendientes.
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => void refetch()}>
                    <Text style={styles.retryText}>Reintentar</Text>
                  </Pressable>
                </View>
              ) : novedades?.novedades.length ? (
                <NovedadesTable rows={novedades.novedades} />
              ) : (
                <View style={styles.feedbackCard}>
                  <Text style={styles.emptyTitle}>Sin pendientes</Text>
                  <Text style={styles.feedbackText}>
                    No tienes novedades abiertas en este momento.
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
            <View style={styles.sidebar}>
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
              {menuItems.map((item) => (
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
                    <Text
                      style={[
                        styles.menuItemText,
                        activeSection === item.value && styles.menuItemTextActive,
                      ]}
                    >
                      {item.label}
                    </Text>
                    <Text style={styles.menuItemDescription}>{item.description}</Text>
                  </View>
                  {(item.value === 'novedades' ||
                    item.value === 'pendientes') &&
                  novedades?.total ? (
                    <View style={styles.menuBadge}>
                      <Text style={styles.menuBadgeText}>{novedades.total}</Text>
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
                accessibilityRole="button"
                onPress={handleLogout}
                style={styles.sidebarLogout}
              >
                <Text style={styles.sidebarLogoutText}>Cerrar sesión</Text>
              </Pressable>
            </View>
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
  return (
    <View style={styles.tableCard}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.tableContainer}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.tableHeaderCell, styles.idColumn]}>ID</Text>
            <Text style={[styles.tableHeaderCell, styles.typeColumn]}>Tipo</Text>
            <Text style={[styles.tableHeaderCell, styles.descriptionColumn]}>
              Descripción
            </Text>
            <Text style={[styles.tableHeaderCell, styles.statusColumn]}>Estado</Text>
          </View>
          {rows.map((novedad) => (
            <View key={novedad.IdNovedad} style={styles.tableRow}>
              <Text style={[styles.tableCell, styles.idColumn]}>
                {novedad.IdNovedad}
              </Text>
              <Text style={[styles.tableCell, styles.typeColumn]}>
                {novedad.TipoNovedad ?? '—'}
              </Text>
              <Text style={[styles.tableCell, styles.descriptionColumn]}>
                {novedad.Descripcion ?? '—'}
              </Text>
              <View style={[styles.statusColumn, styles.statusCell]}>
                <View style={styles.statusDot} />
                <Text style={styles.statusText}>{novedad.Estado ?? 'Sin estado'}</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
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
  logoutButton: {
    padding: spacing.small,
  },
  logoutText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
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
    borderRadius: radius.medium,
    borderWidth: 1,
    overflow: 'hidden',
  },
  tableContainer: {
    padding: spacing.small,
  },
  tableHeaderRow: {
    backgroundColor: colors.navy,
    borderRadius: radius.small,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  tableHeaderCell: {
    color: colors.white,
    fontSize: typography.small,
    fontWeight: '700',
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.medium,
  },
  tableRow: {
    alignItems: 'stretch',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  tableCell: {
    color: colors.text,
    fontSize: typography.small,
    lineHeight: 18,
    paddingHorizontal: spacing.small,
    paddingVertical: spacing.medium,
  },
  idColumn: {
    width: 92,
  },
  typeColumn: {
    width: 130,
  },
  descriptionColumn: {
    width: 260,
  },
  statusColumn: {
    width: 112,
  },
  statusCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xsmall,
    paddingHorizontal: spacing.small,
  },
  statusDot: {
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    height: 8,
    width: 8,
  },
  pendingDot: {
    backgroundColor: colors.warning,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: typography.small,
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
    paddingHorizontal: spacing.large,
    paddingTop: spacing.large,
    position: 'absolute',
    top: 0,
    width: 292,
    zIndex: 2,
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
    borderTopColor: colors.navyLight,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.medium,
    paddingVertical: spacing.medium,
  },
  sidebarLogoutText: {
    color: colors.accentLight,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
