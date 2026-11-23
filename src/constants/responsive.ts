export const RESPONSIVE_BREAKPOINTS = {
  mobile: 768,
  desktop: 1200,
} as const;

export type ResponsiveLayout = 'mobile' | 'tablet' | 'desktop';

export function getResponsiveLayout(width: number): ResponsiveLayout {
  if (width < RESPONSIVE_BREAKPOINTS.mobile) return 'mobile';
  if (width < RESPONSIVE_BREAKPOINTS.desktop) return 'tablet';
  return 'desktop';
}
