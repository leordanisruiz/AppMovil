import { isAxiosError } from 'axios';
import { httpClient } from '../api/httpClient';
import type {
  AuthCredentials,
  AuthSession,
  PasswordRegistrationResponse,
  RegistrationIdentity,
  RegistrationValidation,
} from '../types/auth';
import type { Operador } from '../types/operador';

type EmployeeProfileResponse = {
  Codigo: string | null;
  TipoDocumento: string;
  Identificacion: string;
  NombreCompleto: string | null;
  FechaIngreso: string | null;
  Cargo: string | null;
  EstadoEmpleado: string;
};

type LoginResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  empleado: EmployeeProfileResponse;
};

type ApiErrorResponse = {
  detail?: unknown;
  message?: unknown;
};

function toOperator(employee: EmployeeProfileResponse): Operador {
  return {
    codigo: employee.Codigo,
    tipoDocumento: employee.TipoDocumento,
    identificacion: employee.Identificacion,
    nombreCompleto: employee.NombreCompleto,
    fechaIngreso: employee.FechaIngreso,
    cargo: employee.Cargo,
    estadoEmpleado: employee.EstadoEmpleado,
  };
}

export function getApiErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (isAxiosError<ApiErrorResponse>(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      const messages = detail
        .map((issue) => {
          if (
            issue &&
            typeof issue === 'object' &&
            'msg' in issue &&
            typeof issue.msg === 'string'
          ) {
            return issue.msg;
          }
          return null;
        })
        .filter((message): message is string => message !== null);

      if (messages.length > 0) {
        return messages.join(' ');
      }
    }

    const message = error.response?.data?.message;
    if (typeof message === 'string') {
      return message;
    }
    return error.message || fallback;
  }

  return error instanceof Error ? error.message : fallback;
}

export const authService = {
  async login(credentials: AuthCredentials): Promise<AuthSession> {
    const response = await httpClient.post<LoginResponse>('/auth/login', {
      identificacion: credentials.identificacion,
      password: credentials.password,
    });

    return {
      accessToken: response.data.access_token,
      operator: toOperator(response.data.empleado),
    };
  },

  async validateRegistration(
    identity: RegistrationIdentity,
  ): Promise<RegistrationValidation> {
    const response = await httpClient.post<RegistrationValidation>(
      '/auth/validate-registration',
      identity,
    );
    return response.data;
  },

  async registerPassword(
    identity: RegistrationIdentity,
    password: string,
  ): Promise<PasswordRegistrationResponse> {
    const response = await httpClient.post<PasswordRegistrationResponse>(
      '/auth/register-password',
      { ...identity, password },
    );
    return response.data;
  },
};
