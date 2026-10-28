import type { ReactNode } from 'react';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';

export type PortalNavItem = {
  label: string;
  description: string;
  value: string;
  icon?: string;
};

type DesktopLayoutProps = {
  children: ReactNode;
  items: PortalNavItem[];
  activeSection: string;
  title: string;
  operatorName: string;
  appVersion: string;
  onSelect: (section: string) => void;
  onLogout: () => void;
};

export function MobileLayout({ children }: { children: ReactNode }) {
  return <View style={styles.mobile}>{children}</View>;
}

export function TabletLayout({ children }: { children: ReactNode }) {
  return <View style={styles.tablet}>{children}</View>;
}

export function ResponsiveShell({
  desktop,
  tablet,
  children,
  ...desktopProps
}: DesktopLayoutProps & { desktop: boolean; tablet: boolean }) {
  if (desktop) return <DesktopLayout {...desktopProps}>{children}</DesktopLayout>;
  if (tablet) return <TabletLayout>{children}</TabletLayout>;
  return <MobileLayout>{children}</MobileLayout>;
}

export function DesktopLayout({
  children,
  items,
  activeSection,
  title,
  operatorName,
  appVersion,
  onSelect,
  onLogout,
}: DesktopLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <View style={styles.desktop}>
      <View style={[styles.sidebar, sidebarCollapsed && styles.sidebarCollapsed]}>
        <View style={[styles.brand, sidebarCollapsed && styles.brandCollapsed]}>
          <Image accessibilityLabel="Logo SUMA" source={require('../../assets/brand-logo.png')} resizeMode="contain" style={styles.brandMark} />
          {!sidebarCollapsed ? <View><Text style={styles.brandName}>Portal Operadores</Text><Text style={styles.brandCaption}>SUMA · OPERACIÓN</Text></View> : null}
        </View>
        {!sidebarCollapsed ? <Text style={styles.navCaption}>ESPACIO DE TRABAJO</Text> : null}
        <ScrollView contentContainerStyle={[styles.navList, sidebarCollapsed && styles.navListCollapsed]} showsVerticalScrollIndicator={false}>
          {items.map((item) => {
            const active = activeSection === item.value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={item.value}
                onPress={() => onSelect(item.value)}
                style={[styles.navItem, sidebarCollapsed && styles.navItemCollapsed, active && styles.navItemActive]}
                accessibilityLabel={item.label}
              >
                <Text style={[styles.navIcon, active && styles.navTextActive]}>{item.icon ?? '•'}</Text>
                {!sidebarCollapsed ? <View style={styles.navCopy}><Text style={[styles.navText, active && styles.navTextActive]}>{item.label}</Text><Text style={styles.navDescription}>{item.description}</Text></View> : null}
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={[styles.account, sidebarCollapsed && styles.accountCollapsed]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{operatorName.slice(0, 1).toUpperCase()}</Text></View>
          {!sidebarCollapsed ? <View style={styles.accountCopy}><Text numberOfLines={1} style={styles.accountName}>{operatorName}</Text><Text style={styles.accountMeta}>Sesión activa · v{appVersion}</Text></View> : null}
        </View>
        {!sidebarCollapsed ? <Pressable accessibilityLabel="Cerrar sesión" accessibilityRole="button" onPress={onLogout} style={styles.logout}><Text style={styles.logoutText}>↪  Cerrar sesión</Text></Pressable> : null}
      </View>
      <View style={styles.main}>
        <View style={styles.header}><Pressable accessibilityLabel={sidebarCollapsed ? 'Expandir menú lateral' : 'Contraer menú lateral'} accessibilityRole="button" onPress={() => setSidebarCollapsed((collapsed) => !collapsed)} style={styles.sidebarToggle}><Text style={styles.sidebarToggleText}>{sidebarCollapsed ? '☰' : '‹'}</Text></Pressable><View style={styles.headerCopy}><Text style={styles.headerCaption}>PORTAL DEL OPERADOR</Text><Text style={styles.headerTitle}>{title}</Text></View></View>
        <View style={styles.mainContent}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mobile: { flex: 1 },
  tablet: { flex: 1, backgroundColor: colors.background },
  desktop: { flex: 1, flexDirection: 'row', backgroundColor: '#F4F6F8' },
  sidebar: { width: 264, backgroundColor: colors.navy, borderRightColor: '#4A2727', borderRightWidth: 1, paddingHorizontal: 18, paddingTop: 24, paddingBottom: 14 },
  sidebarCollapsed: { alignItems: 'center', paddingHorizontal: 8, width: 68 },
  brand: { alignItems: 'center', flexDirection: 'row', gap: 11, paddingHorizontal: 4, paddingBottom: 30 },
  brandCollapsed: { justifyContent: 'center', paddingHorizontal: 0, paddingBottom: 20, paddingTop: 2 },
  brandMark: { borderRadius: 10, height: 42, width: 42 },
  brandName: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  brandCaption: { color: '#D2BDBD', fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginTop: 3 },
  navCaption: { color: '#D2BDBD', fontSize: 10, fontWeight: '800', letterSpacing: 1, paddingHorizontal: 9, paddingBottom: 10 },
  navList: { gap: 5 },
  navListCollapsed: { alignItems: 'center', gap: 8 },
  navItem: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 11, minHeight: 54, paddingHorizontal: 10, width: '100%' },
  navItemCollapsed: { justifyContent: 'center', minHeight: 46, paddingHorizontal: 0, width: 46 },
  navItemActive: { backgroundColor: '#5A2929' },
  navIcon: { color: '#D2BDBD', fontSize: 17, fontWeight: '700', textAlign: 'center', width: 22 },
  navCopy: { flex: 1, gap: 2 },
  navText: { color: '#F6EDED', fontSize: 13, fontWeight: '700' },
  navTextActive: { color: '#FFFFFF' },
  navDescription: { color: '#D2BDBD', fontSize: 10 },
  account: { alignItems: 'center', borderTopColor: '#684444', borderTopWidth: 1, flexDirection: 'row', gap: 10, marginTop: 'auto', paddingHorizontal: 4, paddingTop: 18 },
  accountCollapsed: { justifyContent: 'center', paddingHorizontal: 0 },
  avatar: { alignItems: 'center', backgroundColor: '#F1E6E6', borderRadius: radius.pill, height: 38, justifyContent: 'center', width: 38 },
  avatarText: { color: colors.navy, fontSize: 16, fontWeight: '800' },
  accountCopy: { flex: 1, gap: 3 },
  accountName: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  accountMeta: { color: '#D2BDBD', fontSize: 10 },
  logout: { marginTop: 12, paddingHorizontal: 4, paddingVertical: 10 },
  logoutText: { color: '#F6EDED', fontSize: 12, fontWeight: '700' },
  main: { flex: 1, minWidth: 0 },
  header: { alignItems: 'center', backgroundColor: '#FFFFFF', borderBottomColor: '#E7EAEE', borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 82, paddingHorizontal: 36 },
  sidebarToggle: { alignItems: 'center', borderColor: '#E2E6EA', borderRadius: 8, borderWidth: 1, height: 36, justifyContent: 'center', marginRight: 16, width: 36 },
  sidebarToggleText: { color: '#4D5660', fontSize: 18, fontWeight: '700' },
  headerCopy: { flex: 1 },
  headerCaption: { color: '#929AA4', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  headerTitle: { color: '#252B31', fontSize: 20, fontWeight: '800', marginTop: 4 },
  mainContent: { flex: 1, gap: spacing.large, paddingBottom: 20, paddingHorizontal: 36, paddingTop: 28, width: '100%' },
});
