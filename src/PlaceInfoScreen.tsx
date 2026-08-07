import React, { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "./navigation/AppNavigator";
import { useCampusData } from "./context/CampusDataContext";
import SkeletonCard from "./components/SkeletonCard";

type Props = NativeStackScreenProps<RootStackParamList, "PlaceInfo">;
type IconName = React.ComponentProps<typeof Ionicons>["name"];
type TabType = "all" | "departments" | "other";

// Number of skeleton cards shown while data loads.
const SKELETON_COUNT = 7;

// ─── Icon helper ─────────────────────────────────────────────────────────────
function getLocationIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (n.includes("library")) return "library-outline";
  if (n.includes("computer") || n.includes("it")) return "desktop-outline";
  if (n.includes("cafeteria") || n.includes("canteen")) return "restaurant-outline";
  if (n.includes("hostel")) return "bed-outline";
  if (n.includes("auditorium") || n.includes("admin")) return "business-outline";
  if (n.includes("mechanical")) return "construct-outline";
  if (n.includes("civil")) return "hammer-outline";
  if (n.includes("playground") || n.includes("ground") || n.includes("sports"))
    return "football-outline";
  if (n.includes("gate") || n.includes("entrance")) return "enter-outline";
  if (n.includes("hospital") || n.includes("medical")) return "medkit-outline";
  if (n.includes("park") || n.includes("garden")) return "leaf-outline";
  return "location-outline";
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function PlaceInfoScreen({ navigation }: Props) {
  const { isReady, data } = useCampusData();
  const locations = data?.locations ?? [];

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabType>("all");

  // ── Filtering ───────────────────────────────────────────────────────────────
  const tabFiltered = locations.filter((item: any) => {
    if (activeTab === "all") return true;
    const isDepartment = item.type === "department";
    return activeTab === "departments" ? isDepartment : !isDepartment;
  });

  const filteredLocations = tabFiltered.filter((item: any) =>
    (item.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const emptyLabel =
    activeTab === "departments"
      ? "No departments found"
      : activeTab === "other"
        ? "No places found"
        : "No places found";

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Search bar — always visible */}
      <View style={styles.searchSection}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#1565C0" />
          <TextInput
            placeholder="Search places…"
            placeholderTextColor="#94A3B8"
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
            editable={isReady}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Category tabs — always visible */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tab, activeTab === "all" && styles.tabActive]}
            onPress={() => { setActiveTab("all"); setSearch(""); }}
            activeOpacity={0.8}
          >
            <Ionicons
              name="grid-outline"
              size={16}
              color={activeTab === "all" ? "#FFFFFF" : "#1565C0"}
            />
            <Text style={[styles.tabText, activeTab === "all" && styles.tabTextActive]}>
              All
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === "departments" && styles.tabActive]}
            onPress={() => { setActiveTab("departments"); setSearch(""); }}
            activeOpacity={0.8}
          >
            <Ionicons
              name="business-outline"
              size={16}
              color={activeTab === "departments" ? "#FFFFFF" : "#1565C0"}
            />
            <Text style={[styles.tabText, activeTab === "departments" && styles.tabTextActive]}>
              Departments
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tab, activeTab === "other" && styles.tabActive]}
            onPress={() => { setActiveTab("other"); setSearch(""); }}
            activeOpacity={0.8}
          >
            <Ionicons
              name="location-outline"
              size={16}
              color={activeTab === "other" ? "#FFFFFF" : "#1565C0"}
            />
            <Text style={[styles.tabText, activeTab === "other" && styles.tabTextActive]}>
              Others
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Skeleton list — shown while data loads ── */}
      {!isReady && (
        <View style={styles.listContent}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <SkeletonCard key={`skeleton-${i}`} />
          ))}
        </View>
      )}

      {/* ── Real list — only rendered once data is ready ── */}
      {isReady && (
        <FlatList
          data={filteredLocations}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }: { item: any }) => (
            <TouchableOpacity
              style={styles.locationCard}
              onPress={() => navigation.navigate("PlaceDetail", { location: item })}
              activeOpacity={0.8}
            >
              <View style={styles.locationIconContainer}>
                <Ionicons
                  name={getLocationIcon(item.name ?? "")}
                  size={23}
                  color="#1565C0"
                />
              </View>

              <View style={styles.locationDetails}>
                <Text style={styles.locationName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.description ? (
                  <Text style={styles.locationDescription} numberOfLines={1}>
                    {item.description}
                  </Text>
                ) : item.where ? (
                  <Text style={styles.locationDescription} numberOfLines={1}>
                    {item.where}
                  </Text>
                ) : null}
              </View>

              <Ionicons name="chevron-forward" size={21} color="#94A3B8" />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={28} color="#94A3B8" />
              <Text style={styles.emptyStateText}>{emptyLabel}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const PRIMARY = "#1565C0";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F5F7FB",
  },

  // ── Search section ──────────────────────────────────────────────────────────
  searchSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  searchBar: {
    height: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    elevation: 2,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  searchInput: {
    flex: 1,
    height: "100%",
    color: "#1E293B",
    fontSize: 15,
  },

  // ── Tabs ────────────────────────────────────────────────────────────────────
  tabRow: {
    flexDirection: "row",
    gap: 10,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderWidth: 1.5,
    borderColor: PRIMARY,
    borderRadius: 12,
    elevation: 1,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  tabActive: {
    backgroundColor: PRIMARY,
    borderColor: PRIMARY,
    elevation: 4,
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  tabText: {
    color: PRIMARY,
    fontSize: 12,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },

  // ── List ────────────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  locationCard: {
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
  locationIconContainer: {
    width: 44,
    height: 44,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#EAF2FF",
    borderRadius: 14,
  },
  locationDetails: {
    flex: 1,
    gap: 3,
  },
  locationName: {
    color: "#1E293B",
    fontSize: 16,
    fontWeight: "700",
  },
  locationDescription: {
    color: "#64748B",
    fontSize: 13,
  },

  // ── Empty state ─────────────────────────────────────────────────────────────
  emptyState: {
    alignItems: "center",
    paddingTop: 44,
    gap: 8,
  },
  emptyStateText: {
    color: "#64748B",
    fontSize: 14,
  },
});
