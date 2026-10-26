import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { Ref } from 'react';
import { colors, radius, spacing, typography } from '../theme';

type FormInputProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  textContentType?: 'username' | 'password';
  returnKeyType?: 'done' | 'next';
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  maxLength?: number;
  inputRef?: Ref<TextInput>;
};

export function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  textContentType,
  returnKeyType,
  onSubmitEditing,
  onBlur,
  maxLength,
  inputRef,
}: FormInputProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
      ref={inputRef}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        keyboardType={keyboardType}
        maxLength={maxLength}
        onBlur={onBlur}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmitEditing}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        returnKeyType={returnKeyType}
        secureTextEntry={secureTextEntry}
        selectionColor={colors.primary}
        style={styles.input}
        textContentType={textContentType}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.small,
  },
  label: {
    color: colors.text,
    fontSize: typography.caption,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radius.medium,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 54,
    paddingHorizontal: spacing.medium,
  },
});
