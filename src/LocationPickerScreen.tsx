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
import { RootStackParamList } from "./navigation/AppNavigator";
interface Location {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
}

type Props = NativeStackScreenProps<RootStackParamList, "LocationPicker">;

export default function LocationPickerScreen({ navigation, route }: Props) {


  const [locations, setLocations] = useState<Location[]>([]);
  const [search, setSearch] = useState("");
  const isFromSelection = route.params?.type === "from";

  useEffect(() => {
    loadLocations();
  }, []);

  async function loadLocations() {
    try {
      const data = await getLocations();
      setLocations(data as Location[]);
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

      const position = await ExpoLocation.getCurrentPositionAsync({});
      const currentLocation: Location = {
        id: "current-location",
        name: "Current Location",
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        description: "Live device location",
      };

      navigation.popTo("Map", {
        selectedLocation: currentLocation,
        type: "from",
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
          height: 70,
          backgroundColor: "#1565C0",
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 15,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
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
            value={search}
            onChangeText={setSearch}
            style={{
              flex: 1,
              marginLeft: 10,
              height: 45,
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
              }} onPress={() => {
                navigation.popTo("Map", {
                  selectedLocation: item,
                  type: route.params.type,
                });
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
