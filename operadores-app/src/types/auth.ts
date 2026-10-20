import type { Operador } from './operador';

export type AuthCredentials = {
  identificacion: string;
  password: string;
};

export type AuthSession = {
  accessToken: string;
  operator: Operador;
};

export type RegistrationIdentity = {
  tipo_documento: string;
  identificacion: string;
};

export type RegistrationValidation = {
  pertenece_suma: boolean;
  puede_registrar: boolean;
  tipo_usuario: 'OPERADOR' | 'ADMINISTRATIVO' | null;
  nombre_completo: string | null;
  mensaje: string;
};

export type PasswordRegistrationResponse = {
  mensaje: string;
  fecha_creacion: string;
};
