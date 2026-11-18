/** Build-time configuration (EXPO_PUBLIC_* only — never secrets). */
export const config = {
  apiBaseUrl: (process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://10.0.2.2:4000').replace(/\/$/, ''),
  organizationCode: process.env.EXPO_PUBLIC_ORGANIZATION_CODE ?? 'DEV',
};
