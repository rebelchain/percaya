import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MIN_TOUCH_TARGET, RADII, SHADOWS, SPACING, TYPE } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeContext';
import { X } from './icons';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  maxHeightPct?: number;
}

/**
 * Accessible, motion-respecting BottomSheet (`180ms` ease-out, zero native C++ deps).
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  maxHeightPct = 0.85,
}: BottomSheetProps) {
  const { colors } = useTheme();
  const [rendered, setRendered] = useState(visible);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(Boolean(enabled));
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setRendered(true);
      if (reduceMotion) {
        progress.setValue(1);
      } else {
        Animated.timing(progress, {
          toValue: 1,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }
    } else if (rendered) {
      if (reduceMotion) {
        progress.setValue(0);
        setRendered(false);
      } else {
        Animated.timing(progress, {
          toValue: 0,
          duration: 150,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start(({ finished }) => {
          if (finished) setRendered(false);
        });
      }
    }
  }, [visible, reduceMotion, progress, rendered]);

  if (!rendered) return null;

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [280, 0],
  });

  return (
    <Modal visible={rendered} transparent animationType="none" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={s.root}
      >
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: colors.backdrop, opacity: progress },
          ]}
        >
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Dismiss sheet"
          />
        </Animated.View>

        <Animated.View
          style={[
            s.sheet,
            SHADOWS.sheet,
            {
              backgroundColor: colors.surface,
              borderColor: colors.line,
              maxHeight: `${Math.round(maxHeightPct * 100)}%`,
              transform: [{ translateY }],
            },
          ]}
        >
          <SafeAreaView edges={['bottom']}>
            <View style={s.handleWrap}>
              <View style={[s.handle, { backgroundColor: colors.lineStrong }]} />
            </View>

            {(title || subtitle) && (
              <View style={[s.header, { borderBottomColor: colors.line }]}>
                <View style={{ flex: 1, paddingRight: SPACING.sm }}>
                  {title ? (
                    <Text style={[TYPE.title, { color: colors.ink }]}>{title}</Text>
                  ) : null}
                  {subtitle ? (
                    <Text style={[TYPE.caption, { color: colors.ink3, marginTop: 2 }]}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={onClose}
                  style={[s.closeBtn, { backgroundColor: colors.subtle }]}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={18} color={colors.ink2} strokeWidth={2} />
                </Pressable>
              </View>
            )}

            <ScrollView
              bounces={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={s.body}
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: RADII.pill,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
  },
  closeBtn: {
    width: MIN_TOUCH_TARGET - 8,
    height: MIN_TOUCH_TARGET - 8,
    minWidth: 36,
    minHeight: 36,
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xl,
    gap: SPACING.md,
  },
});
