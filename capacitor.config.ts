import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the built site (dist/) and runs it fully offline from the device.
const config: CapacitorConfig = {
  appId: 'dz.adnane.epsilon',
  appName: 'epsilon',
  webDir: 'dist',
  backgroundColor: '#3A157E',
  android: {
    backgroundColor: '#3A157E',
  },
};

export default config;
