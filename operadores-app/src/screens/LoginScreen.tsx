import { useRef, useState } from 'react';
import type { Ref } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  ActivityIndicator,
  Image,
  InputAccessoryView,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../store/AuthProvider';
import { colors, radius, spacing, typography } from '../theme';
import type { RootStackParamList } from '../types/navigation';

type LoginScreenProps = NativeStackScreenProps<RootStackParamList, 'Login'>;

export function LoginScreen({ navigation }: LoginScreenProps) {
  const [identificacion, setIdentificacion] = useState('');
  const [password, setPassword] = useState('');
  const [isRegisterHovered, setIsRegisterHovered] = useState(false);
  const passwordInputRef = useRef<TextInputInstance>(null);
  const { login, isSigningIn, sessionExpired, signInError } = useAuth();

  const handleLogin = () => {
    if (!identificacion.trim() || !password) return;
    Keyboard.dismiss();
    login({ identificacion: identificacion.trim(), password });
  };

  const focusPassword = () => {
    passwordInputRef.current?.focus();
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safeArea}>
      <View pointerEvents="none" style={styles.topDecoration}>
        <View style={styles.decorationBase} />
        <View style={styles.decorationLight} />
        <View style={styles.decorationDeep} />
      </View>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            Platform.OS === 'web' && styles.webScrollContent,
          ]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          <View style={Platform.OS === 'web' ? styles.webContent : undefined}>
            <Image
              accessibilityLabel="Logo corporativo"
              resizeMode="contain"
              source={require('../../assets/brand-symbol.png')}
              style={styles.brandLogo}
            />
            <Text style={styles.brandName}>Portal Operadores</Text>
            <Text style={styles.introTitle}>Tu operación, en un solo lugar.</Text>

            <View
              style={[
                styles.formCard,
                Platform.OS === 'web' && styles.webFormCard,
              ]}
            >
              
              {sessionExpired ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  Tu sesión expiró o dejó de ser válida. Inicia sesión nuevamente.
                </Text>
              ) : null}
              <LoginField
                autoCapitalize="none"
                icon="user"
                keyboardType="number-pad"
                label=""
                onChangeText={setIdentificacion}
                onSubmitEditing={focusPassword}
                placeholder="Identificación"
                returnKeyType="next"
                submitBehavior="submit"
                inputAccessoryViewID={Platform.OS === 'ios' ? 'login-keyboard-actions' : undefined}
                textContentType="username"
                value={identificacion}
              />
              <LoginField
                icon="lock"
                inputRef={passwordInputRef}
                keyboardType="number-pad"
                label=""
                onChangeText={(value) => setPassword(value.replace(/\D/g, ''))}
                onSubmitEditing={handleLogin}
                placeholder="Ingresa tu contraseña"
                returnKeyType="done"
                inputAccessoryViewID={Platform.OS === 'ios' ? 'login-keyboard-actions' : undefined}
                secureTextEntry
                textContentType="password"
                value={password}
              />
              {signInError ? (
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {signInError}
                </Text>
              ) : null}
              <View style={styles.buttonShadow}>
                <LoginSubmitButton
                  disabled={!identificacion.trim() || !password}
                  loading={isSigningIn}
                  onPress={handleLogin}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('Register')}
                onHoverIn={() => setIsRegisterHovered(true)}
                onHoverOut={() => setIsRegisterHovered(false)}
                style={({ pressed }) => [
                  styles.registerLink,
                  (pressed || isRegisterHovered) && styles.registerLinkActive,
                ]}
              >
                <Text
                  style={[
                    styles.registerLinkText,
                    isRegisterHovered && styles.registerLinkTextActive,
                  ]}
                >
                  Registrarse
                </Text>
              </Pressable>
            </View>

            <Text style={styles.footer}>Acceso exclusivo para personal autorizado</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID="login-keyboard-actions">
          <View style={styles.keyboardAccessory}>
            <Pressable
              accessibilityRole="button"
              onPress={focusPassword}
              style={({ pressed }) => [
                styles.keyboardAccessoryButton,
                pressed && styles.keyboardAccessoryButtonPressed,
              ]}
            >
              <Text style={styles.keyboardAccessoryText}>Siguiente</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !identificacion.trim() || !password }}
              disabled={!identificacion.trim() || !password}
              onPress={handleLogin}
              style={({ pressed }) => [
                styles.keyboardAccessoryButton,
                pressed && styles.keyboardAccessoryButtonPressed,
                (!identificacion.trim() || !password) && styles.keyboardAccessoryButtonDisabled,
              ]}
            >
              <Text style={styles.keyboardAccessoryText}>Ingresar</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
    </SafeAreaView>
  );
}

type LoginFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  icon: 'user' | 'lock';
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  textContentType?: 'username' | 'password';
  returnKeyType?: 'done' | 'next';
  onSubmitEditing?: () => void;
  inputRef?: Ref<TextInputInstance>;
  submitBehavior?: 'submit' | 'blurAndSubmit';
  inputAccessoryViewID?: string;
};

function LoginField({
  label,
  value,
  onChangeText,
  placeholder,
  icon,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  textContentType,
  returnKeyType,
  onSubmitEditing,
  inputRef,
  submitBehavior,
  inputAccessoryViewID,
}: LoginFieldProps) {
  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputShell}>
        <View
          pointerEvents="none"
          style={styles.inputIconBox}
        >
          <LoginIcon name={icon} />
        </View>
        <TextInput
          accessibilityLabel={label}
          ref={inputRef}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          submitBehavior={submitBehavior}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmitEditing}
          inputAccessoryViewID={inputAccessoryViewID}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          returnKeyType={returnKeyType}
          blurOnSubmit={false}
          showSoftInputOnFocus
          secureTextEntry={secureTextEntry}
          selectionColor={colors.primary}
          style={styles.input}
          textContentType={textContentType}
          underlineColorAndroid="transparent"
          value={value}
        />
      </View>
    </View>
  );
}

function LoginIcon({ name }: { name: 'user' | 'lock' }) {
  if (name === 'user') {
    return (
      <View style={styles.userIcon}>
        <View style={styles.userHead} />
        <View style={styles.userBody} />
      </View>
    );
  }

  return (
    <View style={styles.lockIcon}>
      <View style={styles.lockShackle} />
      <View style={styles.lockBody}>
        <View style={styles.lockKeyhole} />
      </View>
    </View>
  );
}

function LoginSubmitButton({
  disabled,
  loading,
  onPress,
}: {
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.loginButton,
        isDisabled && styles.loginButtonDisabled,
        pressed && !isDisabled && styles.loginButtonPressed,
      ]}
    >
      <View pointerEvents="none" style={styles.buttonHighlight} />
      {loading ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.loginButtonLabel}>Ingresar</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  topDecoration: {
    height: 180,
    left: 0,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 0,
  },
  decorationBase: {
    backgroundColor: '#FBE1E2',
    borderBottomRightRadius: 100,
    height: 150,
    left: -85,
    position: 'absolute',
    top: -75,
    transform: [{ rotate: '-12deg' }],
    width: '82%',
  },
  decorationLight: {
    backgroundColor: '#F6C3C5',
    borderBottomRightRadius: 36,
    height: 104,
    left: -24,
    opacity: 0.78,
    position: 'absolute',
    top: -47,
    transform: [{ rotate: '15deg' }],
    width: '48%',
  },
  decorationDeep: {
    backgroundColor: '#E8A3A7',
    borderBottomLeftRadius: 34,
    height: 116,
    opacity: 0.55,
    position: 'absolute',
    right: '12%',
    top: -68,
    transform: [{ rotate: '14deg' }],
    width: 88,
  },
  keyboardView: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.large,
    paddingTop: spacing.xxlarge,
    paddingBottom: spacing.xxlarge,
  },
  webScrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
    paddingHorizontal: spacing.large,
    paddingVertical: spacing.xxlarge,
  },
  webContent: {
    alignSelf: 'center',
    maxWidth: 480,
    width: '100%',
  },
  brandLogo: {
    alignSelf: 'center',
    backgroundColor: colors.white,
    borderColor: '#F5E5E5',
    borderRadius: 24,
    borderWidth: 1,
    height: 82,
    marginBottom: spacing.medium,
    padding: 5,
    width: 82,
  },
  brandName: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '600',
    marginBottom: spacing.medium,
    textAlign: 'center',
  },
  introTitle: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '700',
    lineHeight: 21,
    marginBottom: spacing.large,
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: colors.white,
    borderColor: '#EEDCDD',
    borderRadius: 26,
    borderWidth: 1,
    gap: spacing.large,
    padding: spacing.large,
    shadowColor: '#6B2027',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 22,
    elevation: 3,
  },
  webFormCard: {
    borderRadius: 28,
    padding: spacing.xxlarge,
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
  fieldContainer: { gap: spacing.small },
  fieldLabel: {
    color: '#382828',
    fontSize: typography.caption,
    fontWeight: '600',
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#FFFAFA',
    borderColor: '#EADADA',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingLeft: spacing.small,
    paddingRight: spacing.medium,
  },
  inputIconBox: {
    alignItems: 'center',
    backgroundColor: '#FFF1F1',
    borderRadius: 11,
    height: 36,
    justifyContent: 'center',
    marginRight: spacing.small,
    width: 36,
  },
  input: {
    color: colors.text,
    flex: 1,
    fontSize: typography.body,
    minHeight: 54,
    paddingHorizontal: spacing.xsmall,
    paddingVertical: spacing.small,
  },
  keyboardAccessory: {
    alignItems: 'center',
    backgroundColor: '#FFF8F8',
    borderTopColor: '#EEDCDD',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.xsmall,
  },
  keyboardAccessoryButton: {
    borderRadius: radius.small,
    paddingHorizontal: spacing.medium,
    paddingVertical: spacing.small,
  },
  keyboardAccessoryButtonPressed: { backgroundColor: '#FFE3E4' },
  keyboardAccessoryButtonDisabled: { opacity: 0.45 },
  keyboardAccessoryText: {
    color: colors.primary,
    fontSize: typography.body,
    fontWeight: '700',
  },
  userIcon: { alignItems: 'center', height: 20, justifyContent: 'flex-end', width: 20 },
  userHead: {
    backgroundColor: '#C84E55',
    borderRadius: 5,
    height: 8,
    marginBottom: 2,
    width: 8,
  },
  userBody: {
    backgroundColor: '#C84E55',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomLeftRadius: 4,
    borderBottomRightRadius: 4,
    height: 8,
    width: 15,
  },
  lockIcon: { alignItems: 'center', height: 20, justifyContent: 'flex-end', width: 20 },
  lockShackle: {
    borderColor: '#C84E55',
    borderBottomColor: 'transparent',
    borderTopLeftRadius: 7,
    borderTopRightRadius: 7,
    borderWidth: 2,
    height: 11,
    position: 'absolute',
    top: 0,
    width: 12,
  },
  lockBody: {
    alignItems: 'center',
    backgroundColor: '#C84E55',
    borderRadius: 3,
    height: 11,
    justifyContent: 'center',
    width: 17,
  },
  lockKeyhole: { backgroundColor: colors.white, borderRadius: 2, height: 4, width: 2 },
  buttonShadow: {
    borderRadius: radius.medium,
    marginTop: spacing.xsmall,
    shadowColor: '#A82027',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 9,
    elevation: 4,
  },
  loginButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 16,
    justifyContent: 'center',
    minHeight: 58,
    overflow: 'hidden',
    paddingHorizontal: spacing.large,
  },
  loginButtonDisabled: { opacity: 0.62 },
  loginButtonPressed: {
    backgroundColor: colors.primaryPressed,
    transform: [{ scale: 0.99 }],
  },
  buttonHighlight: {
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    height: 22,
    left: 2,
    position: 'absolute',
    right: 2,
    top: 2,
  },
  loginButtonLabel: { color: colors.white, fontSize: typography.body, fontWeight: '700' },
  registerLink: {
    alignSelf: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.large,
    paddingVertical: spacing.small,
  },
  registerLinkActive: {
    backgroundColor: '#FFF1F1',
  },
  registerLinkText: {
    color: colors.primary,
    fontSize: typography.caption,
    fontWeight: '700',
  },
  registerLinkTextActive: { color: colors.primaryPressed, textDecorationLine: 'underline' },
  footer: {
    color: colors.textMuted,
    fontSize: typography.small,
    marginTop: spacing.large,
    textAlign: 'center',
  },
});
