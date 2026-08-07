import React, { useRef, useState } from "react";
import {
  Animated,
  Image,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "./navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "PlaceDetail">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];

// ─── Loose data shape ─────────────────────────────────────────────────────────
// All fields are optional / unknown so that missing fields never cause crashes.
interface LocationDoc {
  name?: unknown;
  type?: unknown;
  description?: unknown;
  imageUrl?: unknown;
  where?: unknown;
  hod?: unknown;
  // For departments: contact is an array of strings in Firestore
  // For other places: contact is a single string (or use phone fallback)
  contact?: unknown;
  phone?: unknown;          // legacy alias for contact (Other Places)
  email?: unknown;
  office?: unknown;
  // department programs – stored as an array of strings in Firestore as `program`
  program?: unknown;
  // Other Places legacy program fields
  programsOffered?: unknown;
  "programs offered"?: unknown;
  courses?: unknown;
  // coordinates – kept in the object for MapScreen; never displayed to the user
  latitude?: unknown;
  longitude?: unknown;
  [key: string]: unknown;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a trimmed non-empty string, or null for any other value. */
function str(value: unknown): string | null {
  if (typeof value === "string") {
    const v = value.trim();
    return v || null;
  }
  if (typeof value === "number" && !Number.isNaN(value)) return String(value);
  return null;
}

/**
 * Normalises the programs / courses field.
 * Handles: string, string[], or any other falsy value.
 * Returns a non-empty array of trimmed strings, or [].
 */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => str(v))
      .filter((v): v is string => v !== null);
  }
  const s = str(value);
  return s ? [s] : [];
}

// ─── InformationRow sub-component ────────────────────────────────────────────
function InformationRow({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.informationRow}>
      <View style={styles.informationIcon}>
        <Ionicons name={icon} size={19} color="#1565C0" />
      </View>
      <View style={styles.informationContent}>
        <Text style={styles.informationLabel}>{label}</Text>
        <Text style={styles.informationValue} selectable>
          {value}
        </Text>
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function PlaceDetailScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();

  // ── Hero image loading state ───────────────────────────────────────────────
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageFade = useRef(new Animated.Value(0)).current;

  function handleImageLoad() {
    setImageLoaded(true);
    Animated.timing(imageFade, {
      toValue: 1,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }
  const location = route.params.location as LocationDoc;

  // ── Safely extract every displayable field ─────────────────────────────────
  const placeName   = str(location.name) ?? "Place Details";
  const imageUrl    = str(location.imageUrl);
  const where       = str(location.where);
  const description = str(location.description);
  const hod         = str(location.hod);
  const isDepartment = location.type === "department";

  // ── Department-specific array fields ──────────────────────────────────────
  // `contact` is an array of strings for departments
  const deptContactList = isDepartment ? toStringArray(location.contact) : [];
  // `program` is the exact Firestore field name for department programs
  const deptProgramList = isDepartment ? toStringArray(location.program) : [];

  // ── Other Places: single-string contact/phone (unchanged) ─────────────────
  const contactSingle = isDepartment
    ? null
    : str(location.contact) ?? str(location.phone);
  const email  = str(location.email);
  const office = str(location.office);

  // Other Places legacy programs field chain (unchanged)
  const programsRaw =
    location.programsOffered ??
    location["programs offered"] ??
    location.courses;
  const otherPrograms = isDepartment ? [] : toStringArray(programsRaw);

  // ── Decide which info-row section to show ──────────────────────────────────
  // Only shown when at least one of these fields exists
  const hasInfoSection =
    (!isDepartment && Boolean(where)) ||
    Boolean(hod)   ||
    Boolean(contactSingle) ||
    Boolean(email) ||
    Boolean(office);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={PRIMARY} />

      {/* ── Custom blue header ──────────────────────────────────────────────── */}
      <View
        style={[
          styles.header,
          { paddingTop: insets.top + (Platform.OS === "android" ? 4 : 0) },
        ]}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {placeName}
        </Text>

        {/* Spacer keeps title centred */}
        <View style={styles.backButton} />
      </View>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero image / branded fallback ── */}
        {imageUrl ? (
          <View style={styles.heroImage}>
            {/* Placeholder — always visible behind the image */}
            <View style={[StyleSheet.absoluteFillObject, styles.heroImagePlaceholder]}>
              <Ionicons name="image-outline" size={36} color="#93C5FD" />
            </View>
            {/* Real image fades in on load */}
            <Animated.Image
              source={{ uri: imageUrl }}
              style={[StyleSheet.absoluteFillObject, styles.heroImageAbsolute, { opacity: imageFade }]}
              resizeMode="cover"
              onLoad={handleImageLoad}
            />
          </View>
        ) : (
          <View style={styles.heroFallback}>
            <Ionicons name="location" size={52} color={PRIMARY} />
            <Text style={styles.heroFallbackText}>Location Information</Text>
          </View>
        )}

        {/* ── Place name (+ department where subtitle) ── */}
        <View style={styles.nameSection}>
          <Text style={styles.placeName} selectable>
            {placeName}
          </Text>
          {isDepartment && where ? (
            <View style={styles.whereSubtitle}>
              <Ionicons name="location-sharp" size={14} color={PRIMARY} />
              <Text style={styles.whereSubtitleText}>{where}</Text>
            </View>
          ) : null}
        </View>

        {/* ── Core info rows (where, hod, contact, email, office) ── */}
        {hasInfoSection && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Details</Text>
            <View style={styles.informationList}>
              {!isDepartment && where ? (
                <InformationRow
                  icon="location-outline"
                  label="Location"
                  value={where}
                />
              ) : null}
              {hod ? (
                <InformationRow
                  icon="person-circle-outline"
                  label="Head of Department"
                  value={hod}
                />
              ) : null}
              {/* Other Places only: single-string contact */}
              {contactSingle ? (
                <InformationRow
                  icon="call-outline"
                  label="Contact"
                  value={contactSingle}
                />
              ) : null}
              {email ? (
                <InformationRow
                  icon="mail-outline"
                  label="Email"
                  value={email}
                />
              ) : null}
              {office ? (
                <InformationRow
                  icon="business-outline"
                  label="Office"
                  value={office}
                />
              ) : null}
            </View>
          </View>
        )}

        {/* ── Department: contact array ── */}
        {isDepartment && deptContactList.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Contact</Text>
            <View style={styles.programList}>
              {deptContactList.map((item, index) => (
                <View key={`contact-${index}`} style={styles.programItem}>
                  <View style={styles.programIconWrap}>
                    <Ionicons name="call-outline" size={17} color={PRIMARY} />
                  </View>
                  <Text style={styles.programText} selectable>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Department: program array ── */}
        {isDepartment && deptProgramList.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Programs Offered</Text>
            <View style={styles.programList}>
              {deptProgramList.map((item, index) => (
                <View key={`program-${index}`} style={styles.programItem}>
                  <View style={styles.programIconWrap}>
                    <Ionicons name="school-outline" size={17} color={PRIMARY} />
                  </View>
                  <Text style={styles.programText} selectable>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── About / description card (Other Places) ── */}
        {description ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.descriptionText} selectable>
              {description}
            </Text>
          </View>
        ) : null}

        {/* ── Other Places: legacy programs / courses card ── */}
        {otherPrograms.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Programs Offered</Text>
            <View style={styles.programList}>
              {otherPrograms.map((item, index) => (
                <View key={`other-prog-${index}`} style={styles.programItem}>
                  <View style={styles.programIconWrap}>
                    <Ionicons name="school-outline" size={17} color={PRIMARY} />
                  </View>
                  <Text style={styles.programText} selectable>
                    {item}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* ── Action button: Show on Map only ── */}
        <TouchableOpacity
          style={styles.showOnMapButton}
          onPress={() =>
            navigation.navigate("Map", {
              intent: "pin",
              location: location as any,
            })
          }
          activeOpacity={0.8}
        >
          <Ionicons name="map-outline" size={20} color={PRIMARY} />
          <Text style={styles.showOnMapText}>Show on Map</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const PRIMARY        = "#1565C0";
const SURFACE        = "#FFFFFF";
const BG             = "#F0F4FA";
const TEXT_PRIMARY   = "#1E293B";
const TEXT_SECONDARY = "#475569";
const TEXT_MUTED     = "#64748B";
const BLUE_TINT      = "#EAF2FF";

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },

  // ── Header ──────────────────────────────────────────────────────────────────
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: PRIMARY,
    paddingHorizontal: 12,
    paddingBottom: 14,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: "center",
    alignItems: "center",
  },
  headerTitle: {
    flex: 1,
    textAlign: "center",
    color: SURFACE,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 0.2,
  },

  // ── Scroll ──────────────────────────────────────────────────────────────────
  scroll: { flex: 1 },
  content: {
    padding: 16,
    gap: 16,
  },

  // ── Hero ────────────────────────────────────────────────────────────────────
  heroImage: {
    width: "100%",
    height: 230,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: BLUE_TINT,
  },
  /** Blue-tint rectangle + centred icon shown behind the image while it loads */
  heroImagePlaceholder: {
    backgroundColor: BLUE_TINT,
    justifyContent: "center",
    alignItems: "center",
  },
  /** Absolute fill so image overlays the placeholder exactly */
  heroImageAbsolute: {
    width: "100%",
    height: "100%",
  },
  heroFallback: {
    width: "100%",
    height: 180,
    borderRadius: 20,
    backgroundColor: BLUE_TINT,
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
  },
  heroFallbackText: {
    color: PRIMARY,
    fontSize: 15,
    fontWeight: "700",
  },

  // ── Name section ────────────────────────────────────────────────────────────
  nameSection: {
    paddingHorizontal: 2,
    gap: 6,
  },
  placeName: {
    color: TEXT_PRIMARY,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 32,
  },
  // Department `where` subtitle — sits directly below the name, separate from Details card
  whereSubtitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  whereSubtitleText: {
    color: PRIMARY,
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },

  // ── Cards ───────────────────────────────────────────────────────────────────
  card: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    padding: 16,
    gap: 14,
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
  },
  sectionTitle: {
    color: PRIMARY,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.1,
  },
  descriptionText: {
    color: TEXT_SECONDARY,
    fontSize: 15,
    lineHeight: 23,
  },

  // ── Information rows ────────────────────────────────────────────────────────
  informationList: { gap: 14 },
  informationRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  informationIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: BLUE_TINT,
    justifyContent: "center",
    alignItems: "center",
  },
  informationContent: {
    flex: 1,
    gap: 2,
    paddingTop: 2,
  },
  informationLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  informationValue: {
    color: TEXT_PRIMARY,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "500",
  },

  // ── Programs ─────────────────────────────────────────────────────────────────
  programList: { gap: 8 },
  programItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: BG,
    borderRadius: 12,
    borderLeftWidth: 3,
    borderLeftColor: PRIMARY,
  },
  programIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: BLUE_TINT,
    justifyContent: "center",
    alignItems: "center",
  },
  programText: {
    flex: 1,
    color: TEXT_PRIMARY,
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },

  // ── Show on Map button ───────────────────────────────────────────────────────
  showOnMapButton: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 9,
    minHeight: 52,
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: PRIMARY,
    borderRadius: 14,
    elevation: 1,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    marginTop: 4,
  },
  showOnMapText: {
    color: PRIMARY,
    fontSize: 16,
    fontWeight: "800",
  },
});
