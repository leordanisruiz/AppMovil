import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { isAxiosError } from 'axios';
import { useMutation } from '@tanstack/react-query';
import { httpClient } from '../api/httpClient';
import { authService, getApiErrorMessage } from '../services/authService';
import { deactivateDevicePushNotifications } from '../services/pushTokenService';
import { tokenStorage } from '../services/tokenStorage';
import type { AuthCredentials } from '../types/auth';
import type { Operador } from '../types/operador';

type AuthContextValue = {
  operator: Operador | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isSigningIn: boolean;
  sessionExpired: boolean;
  signInError: string | null;
  login: (credentials: AuthCredentials) => void;
  logout: () => Promise<void>;
  expireSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isPublicAuthRequest(url: string | undefined): boolean {
  if (!url) return false;

  const path = url.split('?')[0];
  return [
    '/auth/login',
    '/auth/validate-registration',
    '/auth/register-password',
  ].some((route) => path.endsWith(route));
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [operator, setOperator] = useState<Operador | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<number | null>(null);
  const {
    mutate: signIn,
    isPending: isSigningIn,
    error: loginError,
    reset: resetLogin,
  } = useMutation({
    mutationFn: async (credentials: AuthCredentials) => {
      const session = await authService.login(credentials);
      await tokenStorage.saveSession(
        session.accessToken,
        session.operator,
        session.expiresIn,
      );
      return session;
    },
  });

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      try {
        const token = await tokenStorage.get();

        if (token) {
          const expiresAt = await tokenStorage.getExpiresAt();
          if (expiresAt !== null && expiresAt <= Date.now()) {
            await tokenStorage.clear();
            if (isMounted) {
              setSessionExpired(true);
              setTokenExpiresAt(null);
            }
            return;
          }

          const currentOperator = await tokenStorage.getOperator();
          if (currentOperator) {
            if (isMounted) {
              setOperator(currentOperator);
              setTokenExpiresAt(expiresAt);
            }
          } else {
            await tokenStorage.clear();
          }
        }
      } catch (error) {
        try {
          await tokenStorage.clear();
        } catch (clearError) {
          console.error('No se pudo limpiar el token de sesión:', clearError);
        }
        if (isMounted) {
          setOperator(null);
          setTokenExpiresAt(null);
        }
        console.error('No se pudo restaurar la sesión:', error);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void restoreSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(
    (credentials: AuthCredentials) => {
      signIn(credentials, {
        onSuccess: (session) => {
          setSessionExpired(false);
          setOperator(session.operator);
          setTokenExpiresAt(Date.now() + session.expiresIn * 1000);
        },
      });
    },
    [signIn],
  );

  const logout = useCallback(async () => {
    try {
      await deactivateDevicePushNotifications();
    } catch (error) {
      console.warn(
        'No se pudo desactivar el push en el servidor; se cerrará la sesión local:',
        error,
      );
    }

    try {
      await tokenStorage.clear();
    } catch (error) {
      setOperator(null);
      resetLogin();
      throw error;
    }

    setOperator(null);
    setTokenExpiresAt(null);
    setSessionExpired(false);
    resetLogin();
  }, [resetLogin]);

  const expireSession = useCallback(async () => {
    try {
      await tokenStorage.clear();
    } finally {
      setOperator(null);
      setTokenExpiresAt(null);
      setSessionExpired(true);
      resetLogin();
    }
  }, [resetLogin]);

  useEffect(() => {
    if (!operator || tokenExpiresAt === null) return undefined;

    const remainingMilliseconds = tokenExpiresAt - Date.now();
    const timeout = setTimeout(() => {
      void expireSession().catch((error: unknown) => {
        console.error('No se pudo limpiar la sesión vencida:', error);
      });
    }, Math.max(remainingMilliseconds, 0));

    return () => clearTimeout(timeout);
  }, [expireSession, operator, tokenExpiresAt]);

  useEffect(() => {
    if (!operator) return undefined;

    let expirationStarted = false;
    const interceptorId = httpClient.interceptors.response.use(
      (response) => response,
      async (error: unknown) => {
        if (
          !expirationStarted &&
          isAxiosError(error) &&
          error.response?.status === 401 &&
          !isPublicAuthRequest(error.config?.url)
        ) {
          expirationStarted = true;
          try {
            await expireSession();
          } catch (clearError) {
            console.error(
              'No se pudo limpiar la sesión rechazada por el servidor:',
              clearError,
            );
          }
        }

        return Promise.reject(error);
      },
    );

    return () => {
      httpClient.interceptors.response.eject(interceptorId);
    };
  }, [expireSession, operator]);

  const value = useMemo<AuthContextValue>(
    () => ({
      operator,
      isAuthenticated: operator !== null,
      isLoading,
      isSigningIn,
      sessionExpired,
      signInError: loginError
        ? getApiErrorMessage(
            loginError,
            'No fue posible iniciar sesión. Intenta nuevamente.',
          )
        : null,
      login,
      logout,
      expireSession,
    }),
    [
      expireSession,
      isLoading,
      isSigningIn,
      login,
      loginError,
      logout,
      operator,
      sessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth debe usarse dentro de AuthProvider.');
  }

  return context;
}
