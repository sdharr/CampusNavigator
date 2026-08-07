/**
 * SkeletonCard.tsx
 *
 * A shimmer-pulsing placeholder that mirrors the real location list card.
 * Uses only React Native's built-in Animated API — no third-party libraries.
 *
 * Props:
 *   style — optional extra ViewStyle for positioning/margin overrides.
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View, type ViewStyle } from "react-native";

interface SkeletonCardProps {
  style?: ViewStyle;
}

export default function SkeletonCard({ style }: SkeletonCardProps) {
  const shimmer = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 750,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0.4,
          duration: 750,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  return (
    <Animated.View style={[styles.card, { opacity: shimmer }, style]}>
      {/* Icon circle */}
      <View style={styles.iconCircle} />

      {/* Text lines */}
      <View style={styles.textBlock}>
        <View style={styles.lineWide} />
        <View style={styles.lineNarrow} />
      </View>

      {/* Chevron stub */}
      <View style={styles.chevron} />
    </Animated.View>
  );
}

const GREY = "#E2E8F0";

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 13,
    padding: 14,
    marginBottom: 12,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: GREY,
  },
  textBlock: {
    flex: 1,
    gap: 8,
  },
  lineWide: {
    height: 14,
    borderRadius: 7,
    backgroundColor: GREY,
    width: "70%",
  },
  lineNarrow: {
    height: 11,
    borderRadius: 6,
    backgroundColor: GREY,
    width: "45%",
  },
  chevron: {
    width: 14,
    height: 14,
    borderRadius: 4,
    backgroundColor: GREY,
  },
});
