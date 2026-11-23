export function getFirstName(fullName: string): string {
  const firstName = fullName.trim().split(/\s+/)[0];
  return firstName || fullName;
}
