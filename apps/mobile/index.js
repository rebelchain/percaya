import 'react-native-get-random-values';
import { Buffer } from 'buffer';
import { registerRootComponent } from 'expo';
import App from './App';

if (typeof globalThis.Buffer === 'undefined') {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

registerRootComponent(App);
