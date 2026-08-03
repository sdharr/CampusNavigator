import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
} from "react-native";
import { Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Ionicons } from "@expo/vector-icons";

export default function HomeScreen({ navigation }: any) {
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor="#dcdfe8" />

      {/* ════════════════════════════════════════════════════════
          HERO ZONE  (upper ~60 % of the screen)
          Column: logo → building illustration → text
      ════════════════════════════════════════════════════════ */}
      <View style={styles.heroZone}>

        {/* University logo — floats near the top */}
        <View style={styles.logoWrap}>
          <Image
            source={require("../assets/ju3.png")}
            style={styles.logo}
          />
        </View>

        {/* Campus building illustration — clearly visible */}
        <View style={styles.buildingWrap}>
          <Image
            source={require("../assets/ju2.png")}
            style={styles.buildingImage}
          />
          {/* Soft vignette so edges blend into the background */}
          <View style={styles.buildingVignette} />
        </View>

        {/* App title & subtitle sit directly below the illustration */}
        <View style={styles.textBlock}>
          <Text style={styles.university}>Jammu University</Text>
          <Text style={styles.appTitle}>Campus Navigator</Text>
          <Text style={styles.subtitle}>Find your way around Jammu University</Text>
        </View>

      </View>

      {/* ════════════════════════════════════════════════════════
          ACTION ZONE  (lower ~40 % of the screen)
          Two premium cards anchored to the bottom
      ════════════════════════════════════════════════════════ */}
      <View style={styles.actionZone}>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.82}
          onPress={() => navigation.navigate("Map")}
        >
          <View style={styles.cardLeft}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="map-marker-path" size={28} color="#1565C0" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Navigate Campus</Text>
              <Text style={styles.cardSubtitle}>Find shortest path</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.82}
          onPress={() => navigation.navigate("PlaceInfo")}
        >
          <View style={styles.cardLeft}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="office-building" size={28} color="#1565C0" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>Place Information</Text>
              <Text style={styles.cardSubtitle}>Explore campus Places</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={22} color="rgba(255,255,255,0.8)" />
        </TouchableOpacity>

      </View>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({

  root: {
    flex: 1,
    backgroundColor: "#dcdfe8",
  },

  // ── Hero zone: occupies the top ~60 % ──────────────────────────────────────
  heroZone: {
    flex: 4.5,                      // 6 out of 10 total flex units = 60 %
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 10,
  },

  // Logo wrapper — gives it generous breathing room at the top
  logoWrap: {
    alignItems: "center",
    paddingTop: 10,
    paddingBottom: 4,
    top: 40,
  },
  logo: {
    width: 180,
    height: 180,
    resizeMode: "contain",

  },

  // Building illustration — fills the middle band
  buildingWrap: {
    width: "100%",
    flex: 1,                      // takes up remaining hero space
    position: "relative",
    overflow: "hidden",
    marginBottom: -40
  },
  buildingImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
    opacity: 0.65,
    transform: [{ translateY: -60 }]
  },
  // Soft horizontal fade into the background colour
  buildingVignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(220,223,232,0.18)",
  },

  // Text block below the illustration, above the action zone
  textBlock: {
    alignItems: "center",
    paddingHorizontal: 28,
    paddingTop: 0,
    paddingBottom: 10,
    marginTop: -10,
  },
  university: {
    fontSize: 15,
    fontWeight: "600",
    color: "#555",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  appTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: "#0A3D91",
    letterSpacing: -0.5,
    lineHeight: 38,
    marginTop: 2,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    marginTop: 6,
    lineHeight: 20,
    textAlign: "center",
  },

  // ── Action zone: occupies the bottom ~40 % ─────────────────────────────────
  actionZone: {
    flex: 2.5,                      // 4 out of 10 total flex units = 40 %
    justifyContent: "center",
    paddingHorizontal: 22,
    gap: 14,
    paddingBottom: 8,
    marginTop: -25,

  },

  card: {
    backgroundColor: "#1565C0",
    borderRadius: 26,
    paddingVertical: 20,
    paddingHorizontal: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    // Coloured shadow that lifts the card off the background
    shadowColor: "#0D47A1",
    shadowOpacity: 0.32,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 7 },
    elevation: 10,
  },

  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },

  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    // Subtle lift so the white circle reads against the blue card
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },

  cardText: {
    marginLeft: 16,
    flex: 1,
  },

  cardTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.1,
  },

  cardSubtitle: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    marginTop: 3,
  },

  // ── Legacy stubs (kept so any surviving reference doesn't crash) ─────────
  emoji: { fontSize: 60, textAlign: "center", marginBottom: 10 },
  button: { backgroundColor: "#184a7b", paddingVertical: 18, borderRadius: 15, marginBottom: 20, elevation: 3 },
  buttonText: { color: "white", textAlign: "center", fontSize: 18, fontWeight: "600" },
});