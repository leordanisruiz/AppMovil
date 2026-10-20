import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../components/AppButton';
import { FormInput } from '../components/FormInput';
import { useAuth } from '../store/AuthProvider';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: LoginScreenProps) {
  const [identificacion, setIdentificacion] = useState('');
  const [password, setPassword] = useState('');
  const { login, isSigningIn, sessionExpired, signInError } = useAuth();

  const handleLogin = () => {
    login({ identificacion: identificacion.trim(), password });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            accessibilityLabel="Logo corporativo"
            resizeMode="contain"
            source={require('../../assets/brand-symbol.png')}
            style={styles.brandLogo}
          />
          <Text style={styles.brandName}>Portal Operadores</Text>
          <Text style={styles.introTitle}>Tu operación,{'\n'}en un solo lugar.</Text>
          <Text style={styles.introDescription}>
            Ingresa con tus credenciales corporativas para consultar tu información.
          </Text>

          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Iniciar sesión</Text>
            {sessionExpired ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                Tu sesión expiró o dejó de ser válida. Inicia sesión nuevamente.
              </Text>
            ) : null}
            <FormInput
              autoCapitalize="none"
              keyboardType="number-pad"
              label="Identificación"
              onChangeText={setIdentificacion}
              placeholder="Ingresa tu número de identificación"
              returnKeyType="next"
              textContentType="username"
              value={identificacion}
            />
            <FormInput
              label="Contraseña"
              onChangeText={setPassword}
              onSubmitEditing={handleLogin}
              placeholder="Ingresa tu contraseña"
              returnKeyType="done"
              secureTextEntry
              textContentType="password"
              value={password}
            />
            {signInError ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {signInError}
              </Text>
            ) : null}
            <AppButton
              disabled={!identificacion.trim() || !password}
              loading={isSigningIn}
              onPress={handleLogin}
              title="Ingresar"
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Register')}
              style={styles.registerLink}
            >
              <Text style={styles.registerLinkText}>Registrarse</Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>Acceso exclusivo para personal autorizado</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  keyboardView: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.large,
    paddingVertical: spacing.xxlarge,
  },
  brandLogo: {
    alignSelf: 'center',
    borderRadius: radius.medium,
    height: 64,
    marginBottom: spacing.small,
    width: 64,
  },
  brandName: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.xxlarge,
    textAlign: 'center',
  },
  introTitle: {
    color: colors.text,
    fontSize: typography.display,
    fontWeight: '800',
    lineHeight: 40,
    textAlign: 'center',
  },
  introDescription: {
    alignSelf: 'center',
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 21,
    marginBottom: spacing.large,
    marginTop: spacing.small,
    maxWidth: 310,
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.large,
  },
  formTitle: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
    marginBottom: spacing.xsmall,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  registerLink: {
    alignSelf: 'center',
    padding: spacing.small,
  },
  registerLinkText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  footer: {
    color: colors.textMuted,
    fontSize: typography.small,
    marginTop: spacing.large,
    textAlign: 'center',
  },
});
