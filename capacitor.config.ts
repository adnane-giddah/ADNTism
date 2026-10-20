import type { CapacitorConfig } from '@capacitor/cli';

// The Android app bundles the built site (dist/) and runs it fully offline from the device.
const config: CapacitorConfig = {
  appId: 'dz.adnane.epsilon',
  appName: 'epsilon',
  webDir: 'dist',
  backgroundColor: '#0A0A0C',
  android: {
    backgroundColor: '#0A0A0C',
  },
};

export default config;
