import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import React, { useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buildCallDeepLink, parseCallIdFromLink } from '../call-links';
import { RADII, SPACING, TYPE } from '../theme/tokens';
import { useTheme } from '../theme/ThemeContext';
import { BottomSheet } from './ui/BottomSheet';
import { X } from './ui/icons';
import { PrimaryButton, SecondaryButton } from './ui/primitives';

/** Shows the Call's deep link as a QR code so another phone can scan it. */
export function CallQrModal(props: {
  callId: number | null;
  symbol?: string;
  onClose: () => void;
}) {
  const { callId, symbol, onClose } = props;
  const { colors } = useTheme();
  const link = callId !== null ? buildCallDeepLink(callId) : '';

  return (
    <BottomSheet
      visible={callId !== null}
      onClose={onClose}
      title={callId !== null ? `Call #${callId}${symbol ? ` · $${symbol}` : ''}` : 'Call QR'}
      subtitle="Scan with the percaya QR camera to jump straight into this pool."
    >
      {callId !== null && (
        <View style={{ alignItems: 'center', gap: SPACING.sm }}>
          <View style={s.qrBox}>
            <QRCode value={link} size={208} color="#0F1D24" backgroundColor="#FFFFFF" />
          </View>
          <Text selectable style={[TYPE.micro, TYPE.num, { color: colors.accent }]}>
            {link}
          </Text>
        </View>
      )}
      <SecondaryButton label="Close" onPress={onClose} />
    </BottomSheet>
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
      <SafeAreaView style={s.scanRoot} edges={['top', 'bottom']}>
        <View style={s.scanHeader}>
          <Text style={[TYPE.title, { color: '#FFFFFF' }]}>Scan a Call QR</Text>
          <Pressable
            onPress={onClose}
            style={s.closeCircle}
            accessibilityRole="button"
            accessibilityLabel="Close scanner"
          >
            <X size={20} color="#FFFFFF" strokeWidth={2} />
          </Pressable>
        </View>

        {!permission ? (
          <View style={s.center} />
        ) : !permission.granted ? (
          <View style={s.center}>
            <Text style={[TYPE.body, { color: '#E2E8EC', textAlign: 'center', marginBottom: 16 }]}>
              Camera access is only used to scan percaya Call QR codes. Nothing is recorded or
              uploaded.
            </Text>
            <PrimaryButton label="Allow Camera" onPress={requestPermission} />
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
                  setHint('Not a percaya Call QR. Point at a percaya pool code.');
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
  qrBox: {
    padding: 16,
    borderRadius: RADII.lg,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8EC',
  },
  scanRoot: { flex: 1, backgroundColor: '#0B1216' },
  scanHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  closeCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
    backgroundColor: 'rgba(11,18,22,0.82)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    fontSize: 13,
  },
});
