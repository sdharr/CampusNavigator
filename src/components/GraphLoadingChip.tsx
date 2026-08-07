/**
 * GraphLoadingChip.tsx
 *
 * A small branded pill that floats below the map header while the routing
 * graph is being built from Firestore data.
 *
 * Behaviour:
 *   • Fades in immediately when visible=true.
 *   • Fades out and unmounts after the fade-out animation completes.
 *   • The animated dot loops while visible.
 *
 * Props:
 *   visible   — whether to show the chip.
 *   topOffset — distance from the top of the absolute container.
 */

import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text } from "react-native";
import { Ionicons } from "@expo/vector-icons";

interface GraphLoadingChipProps {
  visible: boolean;
  topOffset?: number;
}

export default function GraphLoadingChip({
  visible,
  topOffset = 160,
}: GraphLoadingChipProps) {
  const fadeAnim = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const dotAnim = useRef(new Animated.Value(0.3)).current;
  // Controls actual DOM presence — stays true until the fade-out finishes.
  const [shouldRender, setShouldRender] = useState(visible);

  // Fade in/out and gate unmounting until animation completes.
  useEffect(() => {
    if (visible) {
      setShouldRender(true);
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setShouldRender(false);
      });
    }
  }, [visible, fadeAnim]);

  // Pulse the dot while visible.
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(dotAnim, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, dotAnim]);

  if (!shouldRender) return null;

  return (
    <Animated.View
      style={[styles.chip, { top: topOffset, opacity: fadeAnim }]}
      pointerEvents="none"
    >
      <Ionicons name="map-outline" size={13} color="#1565C0" style={{ marginRight: 5 }} />
      <Text style={styles.label}>Preparing routes</Text>
      <Animated.View style={[styles.dot, { opacity: dotAnim }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  chip: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    elevation: 4,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
    color: "#1565C0",
    letterSpacing: 0.2,
  },
  dot: {
    marginLeft: 6,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#1565C0",
  },
});
