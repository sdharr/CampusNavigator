import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HomeScreen from "../HomeScreen";
import MapScreen from "../MapScreen";
import PlaceInfoScreen from "../PlaceInfoScreen";
import PlaceDetailScreen from "../PlaceDetailScreen";
import LocationPickerScreen from "../LocationPickerScreen";
export type RootStackParamList = {
  Home: undefined;
  LocationPicker: {
    type: "from" | "to";
  };
  Map:
  | undefined
  | {
    selectedLocation?: any;
    type?: "from" | "to";
  };
  PlaceInfo: undefined;
  PlaceDetail: {
    location: any;
  };

};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerTitleAlign: "center",
        }}
      >


        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Map"
          component={MapScreen}
          options={{ headerShown: false }}
        />

        <Stack.Screen
          name="PlaceInfo"
          component={PlaceInfoScreen}
          options={{
            title: "Place Information",
            headerStyle: { backgroundColor: "#1565C0" },
            headerTintColor: "#FFFFFF",
            headerTitleStyle: { fontWeight: "700" },
          }}
        />

        <Stack.Screen
          name="PlaceDetail"
          component={PlaceDetailScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="LocationPicker"
          component={LocationPickerScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
