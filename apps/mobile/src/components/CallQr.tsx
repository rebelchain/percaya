import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { Modal, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { buildCallDeepLink, parseCallIdFromLink } from '../call-links';

const INK = '#0F1D24';
const ACCENT = '#1F6E9C';

/** Shows the Call's deep link as a QR code so another phone can scan it. */
export function CallQrModal(props: {
  callId: number | null;
  symbol?: string;
  onClose: () => void;
}) {
  const { callId, symbol, onClose } = props;
  return (
    <Modal visible={callId !== null} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <View style={s.sheet}>
          <Text style={s.title}>
            Call #{callId}
            {symbol ? ` · $${symbol}` : ''}
          </Text>
          <Text style={s.sub}>
            Scan with the percaya camera to open this pool, its fixed rules, and the join window.
          </Text>
          {callId !== null && (
            <View style={s.qrBox}>
              <QRCode value={buildCallDeepLink(callId)} size={208} color={INK} backgroundColor="#FFFFFF" />
            </View>
          )}
          <Text style={s.link}>{callId !== null ? buildCallDeepLink(callId) : ''}</Text>
          <Pressable style={s.btn} onPress={onClose}>
            <Text style={s.btnText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

/** Full-screen camera that resolves percaya call links. */
export function CallScannerModal(props: {
  visible: boolean;
  onClose: () => void;
  onCallScanned: (callId: number) => void;
}) {
  const { visible, onClose, onCallScanned } = props;
  const [permission, requestPermission] = useCameraPermissions();
  const handled = useRef(false);
  const [hint, setHint] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (visible) {
      handled.current = false;
      setHint(null);
    }
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.scanRoot}>
        <View style={s.scanHeader}>
          <Text style={s.scanTitle}>Scan a Call QR</Text>
          <Pressable onPress={onClose}>
            <Text style={s.scanClose}>Close</Text>
          </Pressable>
        </View>

        {!permission ? (
          <View style={s.center} />
        ) : !permission.granted ? (
          <View style={s.center}>
            <Text style={s.scanBody}>
              Camera access is only used to read percaya Call QR codes. Nothing is recorded or
              uploaded.
            </Text>
            <Pressable style={s.btn} onPress={requestPermission}>
              <Text style={s.btnText}>Allow camera</Text>
            </Pressable>
          </View>
        ) : (
          <View style={s.cameraWrap}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => {
                if (handled.current) return;
                const id = parseCallIdFromLink(data);
                if (id === null) {
                  setHint('Not a percaya Call QR. Try again.');
                  return;
                }
                handled.current = true;
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onCallScanned(id);
              }}
            />
            <View style={s.frame} pointerEvents="none" />
            {hint && <Text style={s.hint}>{hint}</Text>}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(15,29,36,0.55)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, alignItems: 'center', gap: 10 },
  title: { fontSize: 18, fontWeight: '700', color: INK },
  sub: { fontSize: 13, color: '#66777F', textAlign: 'center' },
  qrBox: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#E2E8EC', marginVertical: 6 },
  link: { fontSize: 12, color: ACCENT, fontFamily: 'monospace' },
  btn: { backgroundColor: INK, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 12, marginTop: 6 },
  btnText: { color: '#FFFFFF', fontWeight: '700' },
  scanRoot: { flex: 1, backgroundColor: '#0F1D24' },
  scanHeader: { flexDirection: 'row', justifyContent: 'space-between', padding: 16 },
  scanTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  scanClose: { color: '#9FD0EA', fontSize: 15 },
  scanBody: { color: '#E2E8EC', textAlign: 'center', marginBottom: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  cameraWrap: { flex: 1, margin: 16, borderRadius: 20, overflow: 'hidden' },
  frame: {
    position: 'absolute',
    top: '25%',
    left: '15%',
    width: '70%',
    aspectRatio: 1,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    borderRadius: 18,
  },
  hint: {
    position: 'absolute',
    bottom: 24,
    alignSelf: 'center',
    color: '#FFFFFF',
    backgroundColor: 'rgba(15,29,36,0.7)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
});
