import React, { useEffect, useState } from "react";

import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
} from "react-native";


import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as ExpoLocation from "expo-location";

import { getLocations } from "./services/locationService";
import { CampusLocation, RootStackParamList } from "./navigation/AppNavigator";

type Props = NativeStackScreenProps<RootStackParamList, "LocationPicker">;

export default function LocationPickerScreen({ navigation, route }: Props) {

  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [search, setSearch] = useState("");
  const isFromSelection = route.params?.type === "from";

  useEffect(() => {
    loadLocations();
  }, []);

  async function loadLocations() {
    try {
      const data = await getLocations();
      setLocations(data as CampusLocation[]);
    } catch (error) {
      console.log(error);
    }
  }

  async function selectCurrentLocation() {
    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();

      if (status !== "granted") {
        Alert.alert(
          "Location Permission Needed",
          "Allow location access to use your current position as the starting point."
        );
        return;
      }

      // Use Balanced accuracy: faster than High but still suitable for snapping
      // to a campus road node. A precise fresh fix is obtained again in
      // startNavigation() at High accuracy before live routing begins.
      const position = await ExpoLocation.getCurrentPositionAsync({
        accuracy: ExpoLocation.Accuracy.Balanced,
      });

      const currentLocation: CampusLocation = {
        id: "current-location",
        name: "Current Location",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        description: "Live device location",
      };

      // navigate() works on React Navigation v6 and v7 alike. When the Map
      // screen is already in the stack this will update its route.params and
      // bring it to the front without creating a duplicate entry.
      navigation.navigate("Map", {
        intent: "from",
        location: currentLocation,
        // Echo the preserved TO back so MapScreen can restore both endpoints
        preservedTo: route.params?.currentTo,
      });
    } catch (error) {
      console.log(error);
      Alert.alert(
        "Location Unavailable",
        "We couldn't get your current location. Make sure location services are on and try again."
      );
    }
  }

  const filteredLocations = locations.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase())
  );

  const getIcon = (name: string) => {
    const text = name.toLowerCase();

    if (text.includes("library")) return "library";
    if (text.includes("computer")) return "desktop";
    if (text.includes("cafeteria")) return "restaurant";
    if (text.includes("hostel")) return "bed";
    if (text.includes("auditorium")) return "business";
    if (text.includes("admin")) return "business";
    if (text.includes("mechanical")) return "construct";
    if (text.includes("civil")) return "hammer";

    return "location";
  };

  return (

    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#F5F7FB",
      }}
    >
      <View
        style={{
          height: 90,
          backgroundColor: "#1565C0",
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 15,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={{ marginTop: 20 }}
        >
          <Ionicons
            name="arrow-back"
            size={24}
            color="white"
          />
        </TouchableOpacity>

        <Text
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: "700",
            marginLeft: 20,
            marginTop: 20,
          }}
        >
          Select Location
        </Text>
      </View>

      <View style={{ flex: 1, padding: 16 }}>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "white",
            borderRadius: 12,
            paddingHorizontal: 12,
            marginBottom: 16,
          }}
        >
          <Ionicons name="search" size={20} color="gray" />

          <TextInput
            placeholder="Search location..."
            placeholderTextColor="#888"
            value={search}
            onChangeText={setSearch}
            style={{
              flex: 1,
              marginLeft: 10,
              height: 45,
              color: "#000",
            }}
          />
        </View>
        {
          isFromSelection && (
            <TouchableOpacity
              style={{
                backgroundColor: "white",
                padding: 16,
                borderRadius: 12,
                marginBottom: 12,
                flexDirection: "row",
                alignItems: "center",
              }}
              onPress={selectCurrentLocation}
            >
              <Ionicons
                name="locate"
                size={22}
                color="#2E7D32"
              />

              <Text
                style={{
                  marginLeft: 12,
                  fontSize: 16,
                  fontWeight: "600",
                }}
              >
                Current Location
              </Text>
            </TouchableOpacity>
          )
        }
        <FlatList
          data={filteredLocations}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={{
                backgroundColor: "white",
                padding: 16,
                borderRadius: 12,
                marginBottom: 10,
                flexDirection: "row",
                alignItems: "center",
              }}
              onPress={() => {
                const isFrom = route.params.type === "from";
                if (isFrom) {
                  navigation.navigate("Map", {
                    intent: "from",
                    location: item,
                    // Echo back the preserved TO endpoint
                    preservedTo: route.params.currentTo,
                  });
                } else {
                  navigation.navigate("Map", {
                    intent: "to",
                    location: item,
                    // Echo back the preserved FROM endpoint
                    preservedFrom: route.params.currentFrom,
                  });
                }
              }}
            >
              <Ionicons
                name={getIcon(item.name)}
                size={22}
                color="#1565C0"

              />


              <Text
                style={{
                  marginLeft: 12,
                  flex: 1,
                  fontSize: 16,
                  fontWeight: "600",
                }}
              >
                {item.name}
              </Text>

              <Ionicons
                name="chevron-forward"
                size={18}
                color="gray"
              />
            </TouchableOpacity>
          )}
        />
      </View>
    </SafeAreaView>
  );
}
