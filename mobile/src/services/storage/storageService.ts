// lightweight storage abstraction with in-memory fallback

const memoryStore: Record<string, string> = {};

export const storageService = {
  async getItem(key: string) {
    try {
      // attempt to use AsyncStorage if available
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      return await AsyncStorage.getItem(key);
    } catch (e) {
      return memoryStore[key];
    }
  },
  async setItem(key: string, value: string) {
    try {
      const AsyncStorage = require('@react-native-async-storage/async-storage').default;
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      memoryStore[key] = value;
    }
  },
};
