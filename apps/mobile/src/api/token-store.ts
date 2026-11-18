import * as SecureStore from 'expo-secure-store';

/** Refresh-token storage. Production uses the OS keystore (CLAUDE.md §8). */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'icon.customer.refreshToken';

export const secureTokenStore: TokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token) =>
    SecureStore.setItemAsync(KEY, token, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

export function memoryTokenStore(
  initial: string | null = null,
): TokenStore & { value: string | null } {
  const store = {
    value: initial,
    get: () => Promise.resolve(store.value),
    set: (token: string) => {
      store.value = token;
      return Promise.resolve();
    },
    clear: () => {
      store.value = null;
      return Promise.resolve();
    },
  };
  return store;
}
