import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '../theme';

type SectionHeadingProps = {
  title: string;
  supportingText?: string;
};

export function SectionHeading({ title, supportingText }: SectionHeadingProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {supportingText ? <Text style={styles.supporting}>{supportingText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xsmall,
  },
  title: {
    color: colors.text,
    fontSize: typography.heading,
    fontWeight: '700',
  },
  supporting: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
});
