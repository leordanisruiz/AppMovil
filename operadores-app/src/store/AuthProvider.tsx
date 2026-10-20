import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { useMutation } from '@tanstack/react-query';
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

export function AuthProvider({ children }: PropsWithChildren) {
  const [operator, setOperator] = useState<Operador | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const {
    mutate: signIn,
    isPending: isSigningIn,
    error: loginError,
    reset: resetLogin,
  } = useMutation({
    mutationFn: async (credentials: AuthCredentials) => {
      const session = await authService.login(credentials);
      await tokenStorage.saveSession(session.accessToken, session.operator);
      return session;
    },
  });

  useEffect(() => {
    let isMounted = true;

    const restoreSession = async () => {
      try {
        const token = await tokenStorage.get();

        if (token) {
          const currentOperator = await tokenStorage.getOperator();
          if (currentOperator) {
            if (isMounted) setOperator(currentOperator);
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
    setSessionExpired(false);
    resetLogin();
  }, [resetLogin]);

  const expireSession = useCallback(async () => {
    try {
      await tokenStorage.clear();
    } finally {
      setOperator(null);
      setSessionExpired(true);
      resetLogin();
    }
  }, [resetLogin]);

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
