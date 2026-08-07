/**
 * FindingRoutePanel.tsx
 *
 * A branded bottom-sheet panel shown while MapScreenOSM is obtaining a GPS
 * fix or computing a route. Replaces the tiny in-button spinner with a clear,
 * contextual loading experience.
 *
 * Behaviour:
 *   • Slides up from the bottom when visible=true.
 *   • Slides back down when visible=false.
 *   • Indeterminate progress bar sweeps left-to-right indefinitely.
 *   • Cancel button calls onCancel.
 *
 * Props:
 *   visible   — whether to show the panel.
 *   onCancel  — called when the user taps Cancel.
 *   label     — optional override for the status message.
 */

import React, { useEffect, useRef } from "react";
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

interface FindingRoutePanelProps {
  visible: boolean;
  onCancel: () => void;
  label?: string;
}

const PANEL_HEIGHT = 110;

export default function FindingRoutePanel({
  visible,
  onCancel,
  label = "Getting your location…",
}: FindingRoutePanelProps) {
  const insets = useSafeAreaInsets();
  const slideAnim = useRef(new Animated.Value(PANEL_HEIGHT + 40)).current;
  const barAnim = useRef(new Animated.Value(-1)).current;

  // Slide panel in/out.
  useEffect(() => {
    Animated.spring(slideAnim, {
      toValue: visible ? 0 : PANEL_HEIGHT + 40,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [visible, slideAnim]);

  // Indeterminate progress bar sweep.
  useEffect(() => {
    if (!visible) return;
    barAnim.setValue(-1);
    const loop = Animated.loop(
      Animated.timing(barAnim, {
        toValue: 1,
        duration: 1400,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [visible, barAnim]);

  const barTranslateX = barAnim.interpolate({
    inputRange: [-1, 1],
    outputRange: ["-100%", "100%"],
  });

  return (
    <Animated.View
      style={[
        styles.panel,
        {
          bottom: insets.bottom + 16,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      pointerEvents={visible ? "auto" : "none"}
    >
      {/* Header row */}
      <View style={styles.row}>
        <View style={styles.leftRow}>
          <Ionicons name="navigate-circle-outline" size={20} color="#1565C0" />
          <Text style={styles.label}>{label}</Text>
        </View>
        <TouchableOpacity
          onPress={onCancel}
          style={styles.cancelButton}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      {/* Progress bar track */}
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.bar,
            { transform: [{ translateX: barTranslateX }] },
          ]}
        />
      </View>

      <Text style={styles.subtitle}>
        This may take a few seconds
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: "absolute",
    left: 16,
    right: 16,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 18,
    elevation: 10,
    shadowColor: "#0D47A1",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  leftRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1E293B",
    flex: 1,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "#F1F5F9",
    borderRadius: 10,
  },
  cancelText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  track: {
    height: 5,
    backgroundColor: "#EAF2FF",
    borderRadius: 3,
    overflow: "hidden",
    marginBottom: 10,
  },
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "100%",
    backgroundColor: "#1565C0",
    borderRadius: 3,
    width: "45%",
  },
  subtitle: {
    fontSize: 12,
    color: "#94A3B8",
    fontWeight: "400",
  },
});
