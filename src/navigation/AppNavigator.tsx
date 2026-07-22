import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HomeScreen from "../HomeScreen";
import MapScreen from "../MapScreen";
import PlaceInfoScreen from "../PlaceInfoScreen";
import PlaceDetailScreen from "../PlaceDetailScreen";
import LocationPickerScreen from "../LocationPickerScreen";

// ---------------------------------------------------------------------------
// Shared location type used throughout the navigation system.
// Every named campus location and the virtual "current-location" object
// must conform to this shape.
// ---------------------------------------------------------------------------
export interface CampusLocation {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
}

// ---------------------------------------------------------------------------
// Map route params — discriminated union by `intent` so MapScreen can
// distinguish exactly what it received without ambiguous optional flags.
//
//  "pin"  → open the map and drop an info-pin on the location (view only).
//  "from" → the user has selected this location as the navigation start.
//  "to"   → the user has selected this location as the navigation destination.
// ---------------------------------------------------------------------------
export type MapParams =
  | undefined
  | { intent: "pin";  location: CampusLocation }
  | { intent: "from"; location: CampusLocation; preservedTo?: CampusLocation }
  | { intent: "to";   location: CampusLocation; preservedFrom?: CampusLocation };

export type RootStackParamList = {
  Home: undefined;
  LocationPicker: {
    type: "from" | "to";
    /** The currently-selected FROM location — passed by MapScreen so
     *  LocationPickerScreen can echo it back when returning a TO result,
     *  ensuring both endpoints always coexist in MapScreen state. */
    currentFrom?: CampusLocation;
    /** The currently-selected TO location — passed by MapScreen so
     *  LocationPickerScreen can echo it back when returning a FROM result. */
    currentTo?: CampusLocation;
  };
  Map: MapParams;
  PlaceInfo: undefined;
  // PlaceDetail receives a raw Firestore document — its own screen uses a
  // loose LocationDoc interface with all-optional fields, so we keep `any`
  // here to avoid forcing structural compatibility on the rich Firestore data.
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
