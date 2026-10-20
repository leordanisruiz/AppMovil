import { useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppButton } from '../components/AppButton';
import { FormInput } from '../components/FormInput';
import { authService, getApiErrorMessage } from '../services/authService';
import { colors, radius, spacing, typography } from '../theme';
import type {
  RegistrationIdentity,
  RegistrationValidation,
} from '../types/auth';
import type { RootStackParamList } from '../types/navigation';

type RegisterScreenProps = NativeStackScreenProps<
  RootStackParamList,
  'Register'
>;

const documentTypes = [
  { label: 'Cédula de ciudadanía (C)', value: 'C' },
  { label: 'Permiso (P)', value: 'P' },
  { label: 'Cédula de extranjería (E)', value: 'E' },
  { label: 'M (sin descripción)', value: 'M' },
] as const;

const identityNotFoundMessage =
  'Usuario no existe en Kactus, por favor validar los datos';

export function RegisterScreen({ navigation }: RegisterScreenProps) {
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [identification, setIdentification] = useState('');
  const [isDocumentMenuOpen, setIsDocumentMenuOpen] = useState(false);
  const [validation, setValidation] = useState<RegistrationValidation | null>(
    null,
  );
  const [isValidating, setIsValidating] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const pendingValidations = useRef(new Set<string>());
  const lastValidatedIdentity = useRef<string | null>(null);
  const validationSequence = useRef(0);

  const resetValidation = () => {
    validationSequence.current += 1;
    lastValidatedIdentity.current = null;
    setValidation(null);
    setPassword('');
    setPasswordConfirmation('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };

  const handleValidateIdentity = async () => {
    const trimmedIdentification = identification.trim();
    if (!documentType || !trimmedIdentification) {
      return;
    }

    const identity: RegistrationIdentity = {
      tipo_documento: documentType,
      identificacion: trimmedIdentification,
    };
    const identityKey = `${identity.tipo_documento}:${identity.identificacion}`;
    if (
      lastValidatedIdentity.current === identityKey ||
      pendingValidations.current.has(identityKey)
    ) {
      return;
    }

    pendingValidations.current.add(identityKey);
    const requestSequence = ++validationSequence.current;
    setIsValidating(true);
    setValidation(null);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const result = await authService.validateRegistration(identity);
      if (requestSequence === validationSequence.current) {
        setValidation(result);
        lastValidatedIdentity.current = identityKey;
      }
    } catch (error) {
      if (requestSequence === validationSequence.current) {
        if (isAxiosError(error) && error.response?.status === 404) {
          setValidation({
            pertenece_suma: false,
            puede_registrar: false,
            tipo_usuario: null,
            nombre_completo: null,
            mensaje: identityNotFoundMessage,
          });
          lastValidatedIdentity.current = identityKey;
        } else {
          setErrorMessage(
            getApiErrorMessage(
              error,
              'No fue posible validar la identidad. Intenta nuevamente.',
            ),
          );
        }
      }
    } finally {
      pendingValidations.current.delete(identityKey);
      if (requestSequence === validationSequence.current) {
        setIsValidating(false);
      }
    }
  };

  const canRegister =
    validation?.pertenece_suma === true &&
    validation.puede_registrar === true;
  const hasValidPassword = /^\d{8}$/.test(password);
  const passwordsMatch =
    password.length > 0 && password === passwordConfirmation;

  const handleRegister = async () => {
    if (!canRegister || !documentType || !hasValidPassword || !passwordsMatch) {
      return;
    }

    setIsRegistering(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await authService.registerPassword(
        {
          tipo_documento: documentType,
          identificacion: identification.trim(),
        },
        password,
      );
      setSuccessMessage(response.mensaje);
      setPassword('');
      setPasswordConfirmation('');
    } catch (error) {
      setErrorMessage(
        getApiErrorMessage(
          error,
          'No fue posible registrar la contraseña. Intenta nuevamente.',
        ),
      );
    } finally {
      setIsRegistering(false);
    }
  };

  const selectedDocumentType = documentTypes.find(
    (option) => option.value === documentType,
  );

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
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.goBack()}
            style={styles.backLink}
          >
            <Text style={styles.backLinkText}>Volver al inicio de sesión</Text>
          </Pressable>
          <Image
            accessibilityLabel="Logo corporativo"
            resizeMode="contain"
            source={require('../../assets/brand-symbol.png')}
            style={styles.brandLogo}
          />
          <Text style={styles.title}>Registro de usuario</Text>
          <Text style={styles.subtitle}>
            Valida tu identidad para crear una contraseña administrativa.
          </Text>

          <View style={styles.formCard}>
            <Text style={styles.label}>Tipo de identificación</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: isDocumentMenuOpen }}
              onPress={() => setIsDocumentMenuOpen((isOpen) => !isOpen)}
              style={styles.select}
            >
              <Text
                style={[
                  styles.selectText,
                  !selectedDocumentType && styles.placeholderText,
                ]}
              >
                {selectedDocumentType?.label ??
                  'Selecciona tu tipo de identificación'}
              </Text>
            </Pressable>
            {isDocumentMenuOpen ? (
              <View style={styles.options}>
                {documentTypes.map((option) => (
                  <Pressable
                    accessibilityRole="button"
                    key={option.value}
                    onPress={() => {
                      setDocumentType(option.value);
                      setIsDocumentMenuOpen(false);
                      resetValidation();
                    }}
                    style={styles.option}
                  >
                    <Text style={styles.optionText}>{option.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <FormInput
              keyboardType="number-pad"
              label="Identificación"
              onBlur={handleValidateIdentity}
              onChangeText={(value) => {
                setIdentification(value);
                resetValidation();
              }}
              onSubmitEditing={handleValidateIdentity}
              placeholder="Ingresa tu número de identificación"
              returnKeyType="done"
              value={identification}
            />

            {isValidating ? (
              <Text accessibilityRole="alert" style={styles.statusText}>
                Validando identidad...
              </Text>
            ) : null}

            {validation ? (
              <View
                style={[
                  styles.resultCard,
                  !validation.pertenece_suma && styles.errorCard,
                  validation.puede_registrar && styles.successCard,
                ]}
              >
                {validation.pertenece_suma ? (
                  <>
                    <Text style={styles.resultName}>
                      {validation.nombre_completo ?? 'Nombre no disponible'}
                    </Text>
                    <Text style={styles.resultDetail}>
                      Tipo de usuario:{' '}
                      {validation.tipo_usuario ?? 'No disponible'}
                    </Text>
                  </>
                ) : null}
                <Text
                  accessibilityRole="alert"
                  style={
                    validation.puede_registrar
                      ? styles.resultMessage
                      : styles.errorText
                  }
                >
                  {validation.pertenece_suma
                    ? validation.mensaje
                    : identityNotFoundMessage}
                </Text>
              </View>
            ) : null}

            {canRegister ? (
              <>
                <FormInput
                  keyboardType="number-pad"
                  label="Contraseña (8 dígitos)"
                  maxLength={8}
                  onChangeText={(value) =>
                    setPassword(value.replace(/\D/g, '').slice(0, 8))
                  }
                  placeholder="Ingresa una contraseña de 8 números"
                  returnKeyType="next"
                  secureTextEntry
                  value={password}
                />
                <Text style={styles.helperText}>
                  La contraseña debe tener exactamente ocho números.
                </Text>
                <FormInput
                  keyboardType="number-pad"
                  label="Confirmar contraseña"
                  maxLength={8}
                  onChangeText={(value) =>
                    setPasswordConfirmation(
                      value.replace(/\D/g, '').slice(0, 8),
                    )
                  }
                  onSubmitEditing={handleRegister}
                  placeholder="Repite la contraseña"
                  returnKeyType="done"
                  secureTextEntry
                  value={passwordConfirmation}
                />
                {passwordConfirmation && !passwordsMatch ? (
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    Las contraseñas no coinciden.
                  </Text>
                ) : null}
                {successMessage ? (
                  <Text accessibilityRole="alert" style={styles.successText}>
                    {successMessage}
                  </Text>
                ) : null}
                <AppButton
                  disabled={
                    !hasValidPassword ||
                    !passwordsMatch ||
                    Boolean(successMessage)
                  }
                  loading={isRegistering}
                  onPress={handleRegister}
                  title="Registrar contraseña"
                />
                {successMessage ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('Login')}
                    style={styles.backLink}
                  >
                    <Text style={styles.backLinkText}>
                      Ir a iniciar sesión
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}

            {errorMessage ? (
              <Text accessibilityRole="alert" style={styles.errorText}>
                {errorMessage}
              </Text>
            ) : null}
          </View>
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
    paddingVertical: spacing.large,
  },
  backLink: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.small,
  },
  backLinkText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  brandLogo: {
    borderRadius: radius.medium,
    height: 54,
    marginBottom: spacing.medium,
    width: 54,
  },
  title: {
    color: colors.text,
    fontSize: typography.display,
    fontWeight: '800',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    lineHeight: 21,
    marginBottom: spacing.large,
    marginTop: spacing.small,
  },
  formCard: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.large,
    borderWidth: 1,
    gap: spacing.medium,
    padding: spacing.large,
  },
  label: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  select: {
    alignItems: 'center',
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
    paddingHorizontal: spacing.medium,
  },
  selectText: {
    color: colors.text,
    flex: 1,
    fontSize: typography.caption,
  },
  placeholderText: {
    color: colors.textMuted,
  },
  options: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    marginTop: -spacing.small,
    overflow: 'hidden',
  },
  option: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.medium,
  },
  optionText: {
    color: colors.text,
    fontSize: typography.caption,
  },
  statusText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  resultCard: {
    backgroundColor: colors.background,
    borderRadius: radius.medium,
    gap: spacing.xsmall,
    padding: spacing.medium,
  },
  errorCard: {
    backgroundColor: '#FDECEB',
  },
  successCard: {
    backgroundColor: '#E8F5EE',
  },
  resultName: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: '700',
  },
  resultDetail: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  resultMessage: {
    color: colors.success,
    fontSize: typography.caption,
  },
  helperText: {
    color: colors.textSecondary,
    fontSize: typography.small,
    marginTop: -spacing.small,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.caption,
  },
  successText: {
    color: colors.success,
    fontSize: typography.caption,
    fontWeight: '700',
  },
});
