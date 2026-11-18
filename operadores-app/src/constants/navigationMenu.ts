import { Linking, Platform } from 'react-native';

export type PortalSection =
  | 'inicio'
  | 'novedades'
  | 'tareas'
  | 'tareas-creadas'
  | 'asignacion-tareas'
  | 'mis-datos'
  | 'evidencias';

export type MenuItemValue = PortalSection | 'programacion';

type MenuItem = {
  label: string;
  value: MenuItemValue;
  description: string;
  icon?: string;
};

const menuItems: MenuItem[] = [
  { label: 'Inicio', value: 'inicio', description: 'Resumen del portal' },
  { label: 'Novedades', value: 'novedades', description: 'Comunicados y avisos' },
  { label: 'Evidencias', value: 'evidencias', description: 'Galería de archivos', icon: '▧' },
  { label: 'Tareas', value: 'tareas', description: 'Actividades asignadas', icon: '☑' },
  {
    label: 'Tu Programación',
    value: 'programacion',
    description: 'Programación enlinea desde la web de suma',
    icon: '▦',
  },
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
  { label: 'Mis datos', value: 'mis-datos', description: 'Perfil del Usuario' },
];

export function getVisibleMenuItems(canAssignTasks: boolean, isOperator: boolean): MenuItem[] {
  return menuItems.filter(
    (item) =>
      (item.value !== 'asignacion-tareas' || canAssignTasks) &&
      (item.value !== 'novedades' || isOperator) &&
      (item.value !== 'programacion' || isOperator) &&
      (item.value !== 'tareas' || !canAssignTasks) &&
      (item.value !== 'tareas-creadas' || canAssignTasks),
  );
}

export async function openSchedulePage(): Promise<void> {
  const url = 'https://www.sumasas.com/user/';
  if (Platform.OS === 'web') {
    window.location.assign(url);
  } else {
    await Linking.openURL(url);
  }
}
