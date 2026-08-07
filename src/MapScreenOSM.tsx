import { useEffect, useRef, useState } from "react";
import {
  BackHandler,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Alert,
  Animated,
  StatusBar,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { addLocationRoadEdge } from "./services/locationRoadEdgeService";
import { Graph } from "./services/graphService";
import { dijkstra } from "./services/dijkstraService";
import { findAlternativeRoutes } from "./services/alternativeRouteService";
import { addRoadEdge } from "./services/roadEdgeService";
import {
  RoadNode,
} from "./services/roadNodeService";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CampusLocation, RootStackParamList } from "./navigation/AppNavigator";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { isInsideCampus } from "./constants/campusBoundary";
import * as ExpoLocation from "expo-location";
import {
  haversineDistance,
  buildVirtualGraph,
  GPS_VIRTUAL_NODE_ID,
} from "./services/liveRouteService";
import { useCampusData } from "./context/CampusDataContext";
import GraphLoadingChip from "./components/GraphLoadingChip";
import FindingRoutePanel from "./components/FindingRoutePanel";

import {
  Map,
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  type CameraRef,
  type MapRef,
} from "@maplibre/maplibre-react-native";

// ---------------------------------------------------------------------------
// MapTiler key + style URL

const MAPTILER_KEY = "m8NHB3NwPV0bbo6blhZY";

const STREET_STYLE =
  `https://api.maptiler.com/maps/streets-v2/style.json?key=${MAPTILER_KEY}`;

const SATELLITE_STYLE =
  `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`;

// Change this one line to switch styles
const MAP_STYLE = SATELLITE_STYLE;
// Toggle developer/editing tools for the whole screen.
// When false, all dev-only UI is hidden but the underlying
// functions (connectNodes, connectLocation, etc.) are untouched.
const DEV_MODE = false;

// ---------------------------------------------------------------------------
// Live GPS routing configuration
// ---------------------------------------------------------------------------
const GPS_RECALC_THRESHOLD_METERS = 15;
const GPS_MAX_INSIDE_RADIUS_METERS = 300;
const ARRIVAL_THRESHOLD_METERS = 20;

// Campus centre (lon, lat for MapLibre)
const CAMPUS_CENTER_LNG = 74.866404;
const CAMPUS_CENTER_LAT = 32.716289;

// ---------------------------------------------------------------------------
// Campus map constraints — derived from CAMPUS_BOUNDARY polygon extremes
// Boundary extremes: lat [32.714063, 32.721962], lng [74.862607, 74.874484]
// Buffer: ~1 km ≈ 0.009° lat / 0.011° lng at this latitude
// ---------------------------------------------------------------------------
/** Prevent the user from panning the map more than ~1 km beyond campus edges. */
const CAMPUS_MAX_BOUNDS: [number, number, number, number] = [
  74.851, // west  (campus min lng 74.862607 − 0.011°)
  32.705, // south (campus min lat 32.714063 − 0.009°)
  74.886, // east  (campus max lng 74.874484 + 0.011°)
  32.731, // north (campus max lat 32.721962 + 0.009°)
];
/** Minimum zoom: campus stays visible and recognisable (campus spans ~1 km). */
const CAMPUS_MIN_ZOOM = 13;
/** Maximum zoom: retain MapTiler's full detail for close-up navigation. */
const CAMPUS_MAX_ZOOM = 20;



// ---------------------------------------------------------------------------
// Navigation phase state machine
// ---------------------------------------------------------------------------
enum NavigationPhase {
  IDLE = "IDLE",
  ROUTE_PREVIEW = "ROUTE_PREVIEW",
  NAVIGATING = "NAVIGATING",
  ARRIVED = "ARRIVED",
}

// ---------------------------------------------------------------------------
// Helpers: coordinate conversions
// ---------------------------------------------------------------------------
/** Google Maps {latitude, longitude} → MapLibre [longitude, latitude] */
function toML(c: { latitude: number; longitude: number }): [number, number] {
  return [c.longitude, c.latitude];
}

/** Build a GeoJSON LineString from an array of {lat, lng} objects */
function coordsToLineGeoJSON(
  coords: { latitude: number; longitude: number }[]
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: coords.map(toML),
    },
  };
}

/** Build a GeoJSON FeatureCollection with one LineString per route.
 *  Each feature carries its original routeOptions index in `properties.routeIndex`
 *  so that `queryRenderedFeatures` can identify which route was tapped. */
function routeOptionsToGeoJSON(
  routeOptions: { latitude: number; longitude: number }[][],
  selectedIndex: number
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: routeOptions
      .map((coords, i) => ({ coords, i }))
      .filter(({ i }) => i !== selectedIndex)
      .map(({ coords, i }) => ({
        ...coordsToLineGeoJSON(coords),
        properties: { routeIndex: i },
      })),
  };
}

/** Compute [west, south, east, north] bounds from coords array */
function getBounds(
  coords: { latitude: number; longitude: number }[]
): [number, number, number, number] {
  let west = coords[0].longitude;
  let east = coords[0].longitude;
  let south = coords[0].latitude;
  let north = coords[0].latitude;
  for (const c of coords) {
    if (c.longitude < west) west = c.longitude;
    if (c.longitude > east) east = c.longitude;
    if (c.latitude < south) south = c.latitude;
    if (c.latitude > north) north = c.latitude;
  }
  return [west, south, east, north];
}

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

export default function MapScreenOSM({ route, navigation }: Props) {
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);

  // ---------------------------------------------------------------------------
  // Campus data from the shared context (eliminates 5 Firestore reads per open)
  // ---------------------------------------------------------------------------
  const { isReady: isCampusReady, data: campusData } = useCampusData();
  const locations = (campusData?.locations ?? []) as CampusLocation[];
  const roadNodes = (campusData?.roadNodes ?? []) as RoadNode[];

  const [developerMode, setDeveloperMode] = useState(false);
  const [selectedNode1, setSelectedNode1] = useState<RoadNode | null>(null);
  const [selectedNode2, setSelectedNode2] = useState<RoadNode | null>(null);

  // Pin-only display: shown when intent === "pin" (no routing)
  const [pinLocation, setPinLocation] = useState<CampusLocation | null>(
    route.params?.intent === "pin" ? route.params.location : null
  );
  const [selectedLocation, setSelectedLocation] = useState<CampusLocation | null>(null);
  const [locationConnectMode, setLocationConnectMode] = useState(false);
  const [selectedRoadNode, setSelectedRoadNode] = useState<RoadNode | null>(null);

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [startLocation, setStartLocation] = useState<CampusLocation | null>(null);
  const [endLocation, setEndLocation] = useState<CampusLocation | null>(null);

  const graphRef = useRef<Graph>({});
  const coordinateMapRef = useRef<Record<string, { latitude: number; longitude: number }>>({});
  const [routeCoordinates, setRouteCoordinates] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeOptions, setRouteOptions] = useState<{ latitude: number; longitude: number }[][]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [routeDistanceMeters, setRouteDistanceMeters] = useState<number | null>(null);
  const [routeDurationMinutes, setRouteDurationMinutes] = useState<number | null>(null);
  const [currentLocationCampusStatus, setCurrentLocationCampusStatus] = useState<"inside" | "outside" | null>(null);
  /** Dashed orange access segment: [liveGpsCoord, connectionNodeCoord] */
  const [gpsAccessSegment, setGpsAccessSegment] = useState<{ latitude: number; longitude: number }[] | null>(null);
  /** Current live GPS coordinate shown as the blue pulsing dot on the map. */
  const [liveGpsPosition, setLiveGpsPosition] = useState<{ latitude: number; longitude: number } | null>(null);

  // ---------------------------------------------------------------------------
  // Navigation phase
  // ---------------------------------------------------------------------------
  const [navPhase, setNavPhase] = useState<NavigationPhase>(NavigationPhase.IDLE);

  const bottomCardAnim = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(Platform.OS === "android" ? 220 : 240);

  const [isFollowingUser, setIsFollowingUser] = useState(false);
  const [isFindingRoute, setIsFindingRoute] = useState(false);
  // Derived from the context — true once campusDataService has resolved.
  const isGraphReady = isCampusReady;

  // -- Live GPS watcher refs --
  const locationWatcherRef = useRef<ExpoLocation.LocationSubscription | null>(null);
  const connectionNodeIdRef = useRef<string | null>(null);
  const connectionNodeCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const destinationRef = useRef<string | null>(null);
  const isOutsideCampusRef = useRef<boolean>(false);
  const lastGpsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const roadNodesRef = useRef<RoadNode[]>([]);
  // Tracks the last route.params object we have already processed so that
  // React Navigation re-creating the params reference (due to MapScreenOSM's
  // own state updates) does not re-fire the camera flyTo and override the
  // fitBounds animation issued by findRoute().
  const lastProcessedParamsRef = useRef<typeof route.params>(undefined);
  // If the user presses Find Route before the graph has finished loading,
  // we store the intent here and flush it the moment isGraphReady flips.
  const pendingRouteRef = useRef<boolean>(false);

  // ---------------------------------------------------------------------------
  // Sync refs from context data the moment campus data becomes ready.
  // This replaces the old loadData() useEffect that issued 5 Firestore reads.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!isCampusReady || !campusData) return;

    graphRef.current = campusData.graph;
    roadNodesRef.current = campusData.roadNodes;
    coordinateMapRef.current = campusData.coordinateMap;

    // Focus campus after data is ready
    focusCampus();

    // If opened with a pin intent, fly to it now that the camera is stable
    const params = route.params;
    if (params?.intent === "pin") {
      const loc = params.location;
      if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
        cameraRef.current?.flyTo({
          center: [loc.longitude, loc.latitude],
          zoom: 18,
          duration: 800,
        });
      }
    }

    // Flush a queued Find Route tap
    if (pendingRouteRef.current) {
      pendingRouteRef.current = false;
      console.log("[INIT] campus data ready — flushing queued findRoute call");
      findRoute();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCampusReady]);

  // Stop the GPS watcher when the screen is unmounted
  useEffect(() => { return () => { locationWatcherRef.current?.remove(); }; }, []);

  // Animate the bottom card in/out when a route becomes available
  useEffect(() => {
    Animated.spring(bottomCardAnim, {
      toValue: routeCoordinates.length > 0 ? 1 : 0,
      useNativeDriver: true,
      tension: 70,
      friction: 11,
    }).start();
  }, [routeCoordinates.length]);

  // (Removed: the isGraphReady flush useEffect is now handled inside the
  // isCampusReady useEffect above, keeping everything in one place.)

  // ---------------------------------------------------------------------------
  // Handle incoming route.params from LocationPickerScreen
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const params = route.params;
    if (!params) return;
    // Skip if this is the same params object we already handled. React Navigation
    // may recreate the params reference when the navigator re-renders due to
    // state changes in MapScreenOSM — without this guard the flyTo below fires
    // again and cancels the fitBounds animation from findRoute().
    if (params === lastProcessedParamsRef.current) return;
    lastProcessedParamsRef.current = params;

    if (params.intent === "from") {
      const loc = params.location;
      setFrom(loc.id);
      setStartLocation(loc);
      if (loc.id === "current-location") {
        const isInside = isInsideCampus(loc.latitude, loc.longitude);
        setCurrentLocationCampusStatus(isInside ? "inside" : "outside");
        setRouteCoordinates([]);
        setRouteDistanceMeters(null);
        setRouteDurationMinutes(null);
        setNavPhase(NavigationPhase.IDLE);
      } else {
        setCurrentLocationCampusStatus(null);
        // Animate camera to the chosen From location (skip for current-location
        // since we do not yet have a reliable GPS fix at this point).
        if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
          cameraRef.current?.flyTo({
            center: [loc.longitude, loc.latitude],
            zoom: 17,
            duration: 800,
          });
        }
      }
      if (params.preservedTo) {
        setTo(params.preservedTo.id);
        setEndLocation(params.preservedTo);
      }
    } else if (params.intent === "to") {
      const loc = params.location;
      setTo(loc.id);
      setEndLocation(loc);
      if (params.preservedFrom) {
        setFrom(params.preservedFrom.id);
        setStartLocation(params.preservedFrom);
      }
      // Animate camera to the chosen To location.
      if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
        cameraRef.current?.flyTo({
          center: [loc.longitude, loc.latitude],
          zoom: 17,
          duration: 800,
        });
      }
    } else if (params.intent === "pin") {
      const loc = params.location;
      setPinLocation(loc);
      if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
        cameraRef.current?.flyTo({
          center: [loc.longitude, loc.latitude],
          zoom: 18,
          duration: 1000,
        });
      }
    }
  }, [route.params]);

  // loadData() removed: all data now comes from CampusDataContext.
  // See the isCampusReady useEffect above for ref-sync + focusCampus logic.

  function focusCampus() {
    // Fly to the fixed campus centre at zoom 16 — matches the initialViewState
    // below so the idle camera is always consistent regardless of screen size.
    cameraRef.current?.flyTo({
      center: [CAMPUS_CENTER_LNG, CAMPUS_CENTER_LAT],
      zoom: 16,
      duration: 1000,
    });
  }

  function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function computeRouteStats(coords: { latitude: number; longitude: number }[]) {
    if (coords.length < 2) { setRouteDistanceMeters(null); setRouteDurationMinutes(null); return; }
    let totalMeters = 0;
    for (let i = 0; i < coords.length - 1; i++) {
      totalMeters += calculateDistance(coords[i].latitude, coords[i].longitude, coords[i + 1].latitude, coords[i + 1].longitude);
    }
    const minutes = totalMeters / 1.4 / 60;
    setRouteDistanceMeters(totalMeters);
    setRouteDurationMinutes(minutes);
  }

  function stopLiveGpsWatcher() {
    locationWatcherRef.current?.remove();
    locationWatcherRef.current = null;
  }

  function clearRoute() {
    stopLiveGpsWatcher();
    setRouteCoordinates([]);
    setRouteOptions([]);
    setSelectedRouteIndex(0);
    setRouteDistanceMeters(null);
    setRouteDurationMinutes(null);
    setGpsAccessSegment(null);
    setLiveGpsPosition(null);
    setNavPhase(NavigationPhase.IDLE);
    setIsFollowingUser(false);
    connectionNodeIdRef.current = null;
    connectionNodeCoordRef.current = null;
    destinationRef.current = null;
    lastGpsRef.current = null;
  }

  /**
   * Full navigation reset — called by the header back button and the Android
   * hardware back button whenever the screen has meaningful state.
   *
   * Clears route, endpoints, and all selection state, then returns the camera
   * to the default campus overview.  Only falls through to navigation.goBack()
   * when the screen is already in a fully clean state.
   */
  function resetAll() {
    clearRoute();
    setFrom(null);
    setTo(null);
    setStartLocation(null);
    setEndLocation(null);
    setCurrentLocationCampusStatus(null);
    setPinLocation(null);
    // Reset the params guard so future navigation events are processed fresh.
    lastProcessedParamsRef.current = undefined;
    focusCampus();
  }

  /** True when the screen holds any state that warrants a reset instead of a
   *  direct goBack(). Evaluated inside handleBack() and the BackHandler hook. */
  function hasActiveState() {
    return (
      from !== null ||
      to !== null ||
      routeCoordinates.length > 0 ||
      navPhase !== NavigationPhase.IDLE ||
      pinLocation !== null
    );
  }

  /** Shared logic for header back button and Android hardware back button. */
  function handleBack() {
    if (hasActiveState()) {
      resetAll();
      // Do NOT call navigation.goBack() — we stay on this screen in a clean state.
    } else {
      navigation.goBack();
    }
  }

  // Intercept the Android hardware back button with the same single-press reset.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (hasActiveState()) {
        resetAll();
        return true; // Consumed — prevents the default goBack()
      }
      return false; // Let React Navigation handle it normally
    });
    return () => sub.remove();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, routeCoordinates.length, navPhase, pinLocation]);

  function fitMapToCoords(coords: { latitude: number; longitude: number }[], paddingTop = 260, paddingBottom = 220) {
    if (!coords.length) return;
    const bounds = getBounds(coords);
    cameraRef.current?.fitBounds(bounds, {
      padding: { top: paddingTop, left: 60, right: 60, bottom: paddingBottom },
      duration: 800,
    });
  }

  function displayRoute(coords: { latitude: number; longitude: number }[]) {
    setRouteCoordinates(coords);
    computeRouteStats(coords);
    if (coords.length > 0) {
      fitMapToCoords(coords);
    }
  }

  function selectRoute(index: number) {
    // DEBUG 5 — confirm selectRoute is called and the index is valid
    console.log(`[DEBUG-5] selectRoute called with index=${index}`);
    console.log(`[DEBUG-5] routeOptions.length=${routeOptions.length}`);
    const selectedRoute = routeOptions[index];
    if (!selectedRoute) {
      console.log(`[DEBUG-5] ABORT — no route at index ${index}`);
      return;
    }
    console.log(`[DEBUG-5] setting selectedRouteIndex=${index}, coords.length=${selectedRoute.length}`);
    setSelectedRouteIndex(index);
    setRouteCoordinates(selectedRoute);
    if (gpsAccessSegment && gpsAccessSegment.length >= 2) {
      const fullCoords = [gpsAccessSegment[0], ...selectedRoute];
      computeRouteStats(fullCoords);
      fitMapToCoords(fullCoords);
    } else {
      displayRoute(selectedRoute);
    }
    console.log(`[DEBUG-5] selectRoute completed`);
  }

  // ---------------------------------------------------------------------------
  // Helper: find a valid connection node for a GPS position inside campus.
  // ---------------------------------------------------------------------------
  function findValidConnectionNode(
    gpsLat: number,
    gpsLon: number,
    nodes: RoadNode[],
    graph: Graph
  ): { id: string; coord: { latitude: number; longitude: number } } | null {
    const sorted = [...nodes]
      .map((n) => ({
        node: n,
        dist: haversineDistance(gpsLat, gpsLon, n.latitude, n.longitude),
      }))
      .filter((e) => e.dist <= GPS_MAX_INSIDE_RADIUS_METERS)
      .sort((a, b) => a.dist - b.dist);

    for (const entry of sorted) {
      if (graph[entry.node.id] && graph[entry.node.id].length > 0) {
        return {
          id: entry.node.id,
          coord: { latitude: entry.node.latitude, longitude: entry.node.longitude },
        };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // findRoute
  // ---------------------------------------------------------------------------
  async function findRoute() {
    console.log("[FR] ENTER isFindingRoute=", isFindingRoute, "from=", from, "to=", to, "isGraphReady=", isGraphReady);
    try {
      // ── Guard: graph not yet loaded — queue the call and return ──────────────
      // The useEffect([isGraphReady]) flush will call findRoute() again the
      // instant buildGraph() resolves. No second tap needed.
      if (!isGraphReady) {
        console.log("[FR] GRAPH-NOT-READY: queuing findRoute — will auto-run when graph loads");
        pendingRouteRef.current = true;
        return;
      }
      // ── Guard: spinner already running ──────────────────────────────────────
      console.log("[FR] A. checking isFindingRoute guard");
      if (isFindingRoute) {
        console.log("[FR] A-RETURN: isFindingRoute is true — early exit");
        return;
      }
      console.log("[FR] A-PASS: isFindingRoute is false");

      console.log("[findRoute] 1. Find Route started");

      // ── Guard: from/to missing ───────────────────────────────────────────────
      console.log("[FR] B. checking from/to guard: from=", from, " to=", to);
      if (!from || !to) {
        console.log("[FR] B-RETURN: from or to is null/empty — showing alert");
        Alert.alert("Missing Selection", "Please select both locations.");
        return;
      }
      console.log("[FR] B-PASS: both from and to are set");

      const isCurrentLocation = from === "current-location" && startLocation?.id === "current-location";
      console.log("[FR] C. isCurrentLocation=", isCurrentLocation);

      // ════════════════════════════════════════════════════════════════════════
      // GPS / Current-Location branch
      // ════════════════════════════════════════════════════════════════════════
      if (isCurrentLocation) {
        console.log("[FR] GPS-BRANCH: entering GPS path");
        try {
          setIsFindingRoute(true);
          console.log("[FR] GPS-1: setIsFindingRoute(true) done");

          console.log("[findRoute] 2. Before requesting location permission");
          console.log("[FR] GPS-2-PRE-AWAIT: about to await requestForegroundPermissionsAsync");
          const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
          console.log("[FR] GPS-2-POST-AWAIT: requestForegroundPermissionsAsync resolved, status=", status);

          console.log("[findRoute] 3. After permission granted, status:", status);
          console.log("[FR] GPS-3: checking permission status");
          if (status !== "granted") {
            console.log("[FR] GPS-3-RETURN: permission denied — showing alert");
            Alert.alert("Permission Needed", "Allow location access to calculate the route.");
            setIsFindingRoute(false);
            return;
          }
          console.log("[FR] GPS-3-PASS: permission granted");

          let pos: ExpoLocation.LocationObject;
          console.log("[findRoute] 4. Before getCurrentPositionAsync()");
          console.log("[FR] GPS-4-PRE-AWAIT-HIGH: about to await getCurrentPositionAsync(High)");
          try {
            pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
            console.log("[FR] GPS-4-POST-AWAIT-HIGH: resolved OK");
          } catch (e) {
            console.log("[FR] GPS-4-HIGH-CATCH: High accuracy failed, falling back to Balanced. Error:", e);
            console.log("[FR] GPS-4-PRE-AWAIT-BALANCED: about to await getCurrentPositionAsync(Balanced)");
            pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
            console.log("[FR] GPS-4-POST-AWAIT-BALANCED: resolved OK");
          }
          console.log("[findRoute] 5. After getCurrentPositionAsync(), lat:", pos.coords.latitude, "lon:", pos.coords.longitude);

          setIsFindingRoute(false);
          console.log("[FR] GPS-5: setIsFindingRoute(false) done");

          const gpsLat = pos.coords.latitude;
          const gpsLon = pos.coords.longitude;
          const gpsCoord = { latitude: gpsLat, longitude: gpsLon };

          const freshCurrentLocation: CampusLocation = {
            id: "current-location",
            name: "Current Location",
            description: "Live device location",
            latitude: gpsLat,
            longitude: gpsLon,
          };
          setStartLocation(freshCurrentLocation);

          const isInside = isInsideCampus(gpsLat, gpsLon);
          setCurrentLocationCampusStatus(isInside ? "inside" : "outside");
          console.log("[FR] GPS-6: isInside=", isInside);

          let connNodeId: string;
          let connNodeCoord: { latitude: number; longitude: number };

          if (!isInside) {
            console.log("[FR] GPS-7: outside campus — looking for Main Gate");
            const mainGate = locations.find((loc) => loc.name === "Main Gate");
            if (!mainGate) {
              console.log("[FR] GPS-7-RETURN: Main Gate not found");
              Alert.alert("Entrance Not Found", "Could not find the 'Main Gate' location.");
              clearRoute();
              return;
            }
            if (!graphRef.current[mainGate.id]) {
              console.log("[FR] GPS-7-RETURN: Main Gate not connected to graph");
              Alert.alert("Entrance Not Connected", "The Main Gate location is not yet connected to the campus road graph.");
              clearRoute();
              return;
            }
            connNodeId = mainGate.id;
            connNodeCoord = { latitude: mainGate.latitude, longitude: mainGate.longitude };
            console.log("[FR] GPS-7-PASS: using Main Gate as connection node");
          } else {
            console.log("[FR] GPS-8: inside campus — finding nearest road node");
            const connection = findValidConnectionNode(gpsLat, gpsLon, roadNodesRef.current, graphRef.current);
            if (!connection) {
              console.log("[FR] GPS-8-RETURN: no road node nearby");
              Alert.alert("No Road Node Nearby", `You are inside the campus but no road node was found within ${GPS_MAX_INSIDE_RADIUS_METERS} m.`);
              clearRoute();
              return;
            }
            connNodeId = connection.id;
            connNodeCoord = connection.coord;
            console.log("[FR] GPS-8-PASS: connection node=", connNodeId);
          }

          const accessDist = haversineDistance(gpsLat, gpsLon, connNodeCoord.latitude, connNodeCoord.longitude);
          const virtualGraph = buildVirtualGraph(graphRef.current, connNodeId, accessDist);
          console.log("[FR] GPS-9: virtualGraph built, accessDist=", accessDist);

          coordinateMapRef.current[GPS_VIRTUAL_NODE_ID] = gpsCoord;
          console.log("[findRoute] 6. Before Dijkstra, from:", GPS_VIRTUAL_NODE_ID, "to:", to);
          console.log("[FR] GPS-10-PRE: running dijkstra");
          const path = dijkstra(virtualGraph, GPS_VIRTUAL_NODE_ID, to);
          console.log("[FR] GPS-10-POST: dijkstra done");
          const routePaths = findAlternativeRoutes(virtualGraph, path);
          delete coordinateMapRef.current[GPS_VIRTUAL_NODE_ID];
          console.log("[findRoute] 7. After Dijkstra, path.length:", path.length);

          if (path.length < 2) {
            console.log("[FR] GPS-11-RETURN: path too short, no route found");
            Alert.alert("No Route Found", "Could not find a route from your location to the destination.");
            clearRoute();
            return;
          }
          console.log("[FR] GPS-11-PASS: valid path found, length=", path.length);

          const campusPath = path.slice(1);
          const campusCoords = campusPath
            .map((id) => coordinateMapRef.current[id])
            .filter(Boolean) as { latitude: number; longitude: number }[];

          const altCampusOptions = routePaths
            .slice(1)
            .map((altPath) =>
              altPath.slice(1).map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[]
            )
            .filter((coords) => coords.length >= 1);

          const allRouteOptions = [campusCoords, ...altCampusOptions];
          setRouteOptions(allRouteOptions);
          setSelectedRouteIndex(0);
          console.log("[findRoute] 8. Before setRouteCoordinates(), campusCoords.length:", campusCoords.length);
          setRouteCoordinates(campusCoords);
          setNavPhase(NavigationPhase.ROUTE_PREVIEW);
          computeRouteStats([gpsCoord, ...campusCoords]);

          const allVisibleCoords = [gpsCoord, ...campusCoords];
          fitMapToCoords(allVisibleCoords);
          console.log("[FR] GPS-12: fitMapToCoords called");

          connectionNodeIdRef.current = connNodeId;
          connectionNodeCoordRef.current = connNodeCoord;
          destinationRef.current = to;
          isOutsideCampusRef.current = !isInside;
          lastGpsRef.current = gpsCoord;
          console.log("[findRoute] 9. Before setIsFindingRoute(false) — GPS path success");
          console.log("[findRoute] 10. End of function — GPS path");
          console.log("[FR] GPS-RETURN-SUCCESS: returning normally");
          return;
        } catch (error) {
          console.log("[FR] GPS-CATCH: caught error in GPS branch:", error);
          console.log("findRoute GPS error:", error);
          Alert.alert("GPS Error", "Could not obtain your current location. Please try again.");
          setIsFindingRoute(false);
          console.log("[FR] GPS-CATCH-RETURN: returning after GPS error");
          return;
        }
      }

      // ════════════════════════════════════════════════════════════════════════
      // Campus-to-campus branch (synchronous)
      // ════════════════════════════════════════════════════════════════════════
      console.log("[FR] CAMPUS-BRANCH: entering campus-to-campus path");

      console.log("[FR] CAMPUS-1: locations.length=", locations.length, "  looking up to=", to);
      const end = locations.find((item) => item.id === to) || null;
      console.log("[FR] CAMPUS-1-RESULT: end=", end ? end.name : "null");
      setEndLocation(end);

      console.log("[findRoute] 6. Before Dijkstra (campus), from:", from, "to:", to);
      console.log("[FR] CAMPUS-2-PRE: graphRef.current keys count=", Object.keys(graphRef.current).length);
      const path = dijkstra(graphRef.current, from, to);
      console.log("[findRoute] 7. After Dijkstra (campus), path.length:", path.length);
      console.log("[FR] CAMPUS-2-POST: dijkstra returned path=", JSON.stringify(path));

      console.log("[FR] CAMPUS-3: checking path length < 2");
      if (path.length < 2) {
        console.log("[FR] CAMPUS-3-RETURN: path too short, showing No Route Found alert");
        Alert.alert("No Route Found", "Could not find a route between these locations.");
        clearRoute();
        return;
      }
      console.log("[FR] CAMPUS-3-PASS: path is valid, length=", path.length);

      console.log("[FR] CAMPUS-4: computing alternative routes");
      const routePaths = findAlternativeRoutes(graphRef.current, path);
      console.log("[FR] CAMPUS-4-DONE: routePaths.length=", routePaths.length);

      console.log("[FR] CAMPUS-5: mapping path to coordinates, coordinateMapRef keys=", Object.keys(coordinateMapRef.current).length);
      const pathCoordinates = path.map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[];
      console.log("[FR] CAMPUS-5-DONE: pathCoordinates.length=", pathCoordinates.length, " (path had", path.length, "nodes)");

      const alternativeRouteCoordinates = routePaths.slice(1).map((routePath) => {
        const coordinates = routePath.map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[];
        return coordinates.length === routePath.length ? coordinates : null;
      }).filter((coordinates): coordinates is { latitude: number; longitude: number }[] => coordinates !== null);
      console.log("[FR] CAMPUS-6: alternativeRouteCoordinates.length=", alternativeRouteCoordinates.length);

      const availableRouteOptions = [pathCoordinates, ...alternativeRouteCoordinates];
      setRouteOptions(availableRouteOptions);
      setSelectedRouteIndex(0);
      setNavPhase(NavigationPhase.ROUTE_PREVIEW);
      console.log("[findRoute] 8. Before setRouteCoordinates() (campus), pathCoordinates.length:", pathCoordinates.length);
      console.log("[FR] CAMPUS-7-PRE: about to call displayRoute");
      displayRoute(pathCoordinates);
      console.log("[FR] CAMPUS-7-POST: displayRoute returned");
      console.log("[findRoute] 9. Before setIsFindingRoute(false) — campus path success");
      console.log("[findRoute] 10. End of function — campus path");
      console.log("[FR] CAMPUS-RETURN-SUCCESS: returning normally");
    } catch (e) {
      console.error("[FR] UNCAUGHT exception in findRoute:", e);
      throw e;
    } finally {
      console.log("[FR] FINALLY: findRoute exiting");
    }
  }

  // ---------------------------------------------------------------------------
  // startNavigation
  // ---------------------------------------------------------------------------
  async function startNavigation() {
    if (from !== "current-location") {
      Alert.alert("Cannot Start", "Select Current Location as your starting point first.");
      return;
    }
    if (!to) {
      Alert.alert("Cannot Start", "Please select a destination first.");
      return;
    }

    try {
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Needed", "Allow location access to start navigation.");
        return;
      }

      let pos: ExpoLocation.LocationObject;
      try {
        pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.High });
      } catch {
        pos = await ExpoLocation.getCurrentPositionAsync({ accuracy: ExpoLocation.Accuracy.Balanced });
      }
      const gpsLat = pos.coords.latitude;
      const gpsLon = pos.coords.longitude;
      const gpsCoord = { latitude: gpsLat, longitude: gpsLon };

      const isInside = isInsideCampus(gpsLat, gpsLon);
      setCurrentLocationCampusStatus(isInside ? "inside" : "outside");

      let connNodeId: string;
      let connNodeCoord: { latitude: number; longitude: number };

      if (!isInside) {
        const mainGate = locations.find((loc) => loc.name === "Main Gate");
        if (!mainGate) {
          Alert.alert("Entrance Not Found", "Could not find the 'Main Gate' location.");
          return;
        }
        if (!graphRef.current[mainGate.id]) {
          Alert.alert("Entrance Not Connected", "The Main Gate location is not yet connected to the campus road graph.");
          return;
        }
        connNodeId = mainGate.id;
        connNodeCoord = { latitude: mainGate.latitude, longitude: mainGate.longitude };
      } else {
        const connection = findValidConnectionNode(gpsLat, gpsLon, roadNodesRef.current, graphRef.current);
        if (!connection) {
          Alert.alert("No Road Node Nearby", `You are inside the campus but no road node was found within ${GPS_MAX_INSIDE_RADIUS_METERS} m.`);
          return;
        }
        connNodeId = connection.id;
        connNodeCoord = connection.coord;
      }

      const accessDist = haversineDistance(gpsLat, gpsLon, connNodeCoord.latitude, connNodeCoord.longitude);
      const virtualGraph = buildVirtualGraph(graphRef.current, connNodeId, accessDist);

      coordinateMapRef.current[GPS_VIRTUAL_NODE_ID] = gpsCoord;
      const path = dijkstra(virtualGraph, GPS_VIRTUAL_NODE_ID, to);
      const routePaths = findAlternativeRoutes(virtualGraph, path);
      delete coordinateMapRef.current[GPS_VIRTUAL_NODE_ID];

      if (path.length < 2) {
        Alert.alert("No Route Found", "Could not compute a live route to the destination.");
        return;
      }

      const campusPath = path.slice(1);
      const campusCoords = campusPath
        .map((id) => coordinateMapRef.current[id])
        .filter(Boolean) as { latitude: number; longitude: number }[];

      const altCampusOptions = routePaths
        .slice(1)
        .map((altPath) =>
          altPath.slice(1).map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[]
        )
        .filter((c) => c.length >= 1);

      setRouteOptions([campusCoords, ...altCampusOptions]);
      setSelectedRouteIndex(0);
      setRouteCoordinates(campusCoords);
      setGpsAccessSegment([gpsCoord, connNodeCoord]);
      setLiveGpsPosition(gpsCoord);
      setNavPhase(NavigationPhase.NAVIGATING);
      setIsFollowingUser(true);
      computeRouteStats([gpsCoord, ...campusCoords]);

      cameraRef.current?.flyTo({
        center: [gpsLon, gpsLat],
        zoom: 17,
        duration: 800,
      });

      connectionNodeIdRef.current = connNodeId;
      connectionNodeCoordRef.current = connNodeCoord;
      destinationRef.current = to;
      isOutsideCampusRef.current = !isInside;
      lastGpsRef.current = gpsCoord;

      startLiveGpsWatcher();
    } catch (error) {
      console.log("startNavigation error:", error);
      Alert.alert("Error", "Could not start navigation. Please try again.");
    }
  }

  // ---------------------------------------------------------------------------
  // cancelNavigation
  // ---------------------------------------------------------------------------
  function cancelNavigation() {
    stopLiveGpsWatcher();
    setGpsAccessSegment(null);
    setLiveGpsPosition(null);
    setIsFollowingUser(false);
    connectionNodeIdRef.current = null;
    connectionNodeCoordRef.current = null;
    lastGpsRef.current = null;
    if (routeCoordinates.length > 0) {
      setNavPhase(NavigationPhase.ROUTE_PREVIEW);
    } else {
      setNavPhase(NavigationPhase.IDLE);
    }
  }

  // ---------------------------------------------------------------------------
  // Live GPS watcher
  // ---------------------------------------------------------------------------
  async function startLiveGpsWatcher() {
    stopLiveGpsWatcher();
    try {
      const sub = await ExpoLocation.watchPositionAsync(
        { accuracy: ExpoLocation.Accuracy.High, distanceInterval: 5 },
        onGpsUpdate
      );
      locationWatcherRef.current = sub;
    } catch (error) {
      console.log("GPS watcher error:", error);
      Alert.alert("GPS Error", "Lost GPS signal. Navigation may be less accurate.");
    }
  }

  function onGpsUpdate(pos: ExpoLocation.LocationObject) {
    const newGps = {
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    };
    const connNodeId = connectionNodeIdRef.current;
    const connNodeCoord = connectionNodeCoordRef.current;
    const destId = destinationRef.current;

    if (!connNodeId || !connNodeCoord || !destId) return;

    setLiveGpsPosition(newGps);
    setGpsAccessSegment([newGps, connNodeCoord]);

    // Arrival check
    const destCoord = coordinateMapRef.current[destId];
    if (destCoord) {
      const distToDest = haversineDistance(newGps.latitude, newGps.longitude, destCoord.latitude, destCoord.longitude);
      if (distToDest < ARRIVAL_THRESHOLD_METERS) {
        stopLiveGpsWatcher();
        setGpsAccessSegment(null);
        setRouteCoordinates([]);
        setNavPhase(NavigationPhase.ARRIVED);
        return;
      }
    }

    // Camera follow
    if (isFollowingUser) {
      cameraRef.current?.easeTo({
        center: [newGps.longitude, newGps.latitude],
        zoom: 17,
        duration: 300,
      });
    }

    // Movement threshold
    const last = lastGpsRef.current;
    const moved = last
      ? haversineDistance(last.latitude, last.longitude, newGps.latitude, newGps.longitude)
      : Infinity;
    lastGpsRef.current = newGps;

    if (isOutsideCampusRef.current) return;
    if (moved < GPS_RECALC_THRESHOLD_METERS) return;

    const connection = findValidConnectionNode(newGps.latitude, newGps.longitude, roadNodesRef.current, graphRef.current);
    if (!connection) return;

    // ----- FIX: removed `if (connection.id === connNodeId) return;` -----
    // That guard blocked ALL route/distance updates whenever the nearest road
    // node hadn't changed yet — the common case while walking along a segment.
    // We now always recompute the remaining route after sufficient movement.

    const newConnNodeCoord = connection.coord;
    const accessDist = haversineDistance(newGps.latitude, newGps.longitude, newConnNodeCoord.latitude, newConnNodeCoord.longitude);
    const virtualGraph = buildVirtualGraph(graphRef.current, connection.id, accessDist);

    coordinateMapRef.current[GPS_VIRTUAL_NODE_ID] = newGps;
    const path = dijkstra(virtualGraph, GPS_VIRTUAL_NODE_ID, destId);
    delete coordinateMapRef.current[GPS_VIRTUAL_NODE_ID];

    if (path.length < 2) return;

    const campusPath = path.slice(1);
    const campusCoords = campusPath.map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[];

    // Trim the leading waypoints that the user has already walked past.
    // Find the waypoint index closest to the current GPS position and slice
    // from there so the already-walked portion of the blue line disappears.
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < campusCoords.length; i++) {
      const d = haversineDistance(
        newGps.latitude, newGps.longitude,
        campusCoords[i].latitude, campusCoords[i].longitude
      );
      if (d < closestDist) { closestDist = d; closestIdx = i; }
    }
    const remainingCoords = campusCoords.slice(closestIdx);

    connectionNodeIdRef.current = connection.id;
    connectionNodeCoordRef.current = newConnNodeCoord;
    setGpsAccessSegment([newGps, newConnNodeCoord]);
    setRouteCoordinates(remainingCoords);
    computeRouteStats([newGps, ...remainingCoords]);
  }

  function selectNode(node: RoadNode) {
    if (locationConnectMode) { setSelectedRoadNode(node); return; }
    if (!selectedNode1) { setSelectedNode1(node); return; }
    if (!selectedNode2 && node.id !== selectedNode1.id) { setSelectedNode2(node); return; }
    setSelectedNode1(node);
    setSelectedNode2(null);
  }

  function selectLocation(location: CampusLocation) {
    if (!locationConnectMode) return;
    setSelectedLocation(location);
  }

  async function connectNodes() {
    if (!selectedNode1 || !selectedNode2) { Alert.alert("Select Two Nodes", "Please select two road nodes first."); return; }
    try {
      const distance = calculateDistance(selectedNode1.latitude, selectedNode1.longitude, selectedNode2.latitude, selectedNode2.longitude);
      await addRoadEdge(selectedNode1.id, selectedNode2.id, Math.round(distance * 100) / 100);
      Alert.alert("Success", "Road connection saved!");
      setSelectedNode1(null);
      setSelectedNode2(null);
    } catch (error) { console.log(error); Alert.alert("Error", "Failed to save road connection."); }
  }

  async function connectLocation() {
    if (!selectedLocation || !selectedRoadNode) { Alert.alert("Select", "Select one location and one road node."); return; }
    try {
      const distance = calculateDistance(selectedLocation.latitude, selectedLocation.longitude, selectedRoadNode.latitude, selectedRoadNode.longitude);
      await addLocationRoadEdge(selectedLocation.id, selectedRoadNode.id, Math.round(distance * 100) / 100);
      Alert.alert("Success", "Location connected successfully!");
      setSelectedLocation(null);
      setSelectedRoadNode(null);
    } catch (e) { console.log(e); Alert.alert("Error", "Could not connect location."); }
  }

  function swapFromTo() {
    const prevFrom = from;
    const prevTo = to;
    const prevStart = startLocation;
    const prevEnd = endLocation;
    setFrom(prevTo);
    setTo(prevFrom);
    setStartLocation(prevEnd);
    setEndLocation(prevStart);
    setCurrentLocationCampusStatus(null);
    clearRoute();
  }

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------
  const distanceLabel = routeDistanceMeters !== null
    ? routeDistanceMeters >= 1000 ? `${(routeDistanceMeters / 1000).toFixed(2)} km` : `${Math.round(routeDistanceMeters)} m`
    : "--";

  const durationLabel = routeDurationMinutes !== null
    ? routeDurationMinutes < 1 ? "< 1 min" : `${Math.round(routeDurationMinutes)} min`
    : "--";

  const showBottomCard = routeCoordinates.length > 0 && navPhase !== NavigationPhase.NAVIGATING && navPhase !== NavigationPhase.ARRIVED;
  const isCurrentLocationRoute = from === "current-location" && startLocation?.id === "current-location";
  const isNavigating = navPhase === NavigationPhase.NAVIGATING;
  const isArrived = navPhase === NavigationPhase.ARRIVED;

  const bottomCardTranslateY = bottomCardAnim.interpolate({ inputRange: [0, 1], outputRange: [160, 0] });
  const bottomCardOpacity = bottomCardAnim;

  // ---------------------------------------------------------------------------
  // GeoJSON data for map layers
  // ---------------------------------------------------------------------------
  // Always a FeatureCollection so the GeoJSONSource stays mounted across renders.
  // Switching from null→Feature caused conditional mount/unmount, which meant
  // the first click registered a brand-new native source (async) while fitBounds
  // was already animating — the layer missed the first render frame.
  const mainRouteGeoJSON: GeoJSON.FeatureCollection = routeCoordinates.length > 1
    ? { type: "FeatureCollection", features: [coordsToLineGeoJSON(routeCoordinates)] }
    : { type: "FeatureCollection", features: [] };

  const altRoutesGeoJSON: GeoJSON.FeatureCollection =
    routeOptions.length > 1
      ? routeOptionsToGeoJSON(routeOptions, selectedRouteIndex)
      : { type: "FeatureCollection", features: [] };

  const accessSegmentGeoJSON: GeoJSON.Feature<GeoJSON.LineString> | null =
    isNavigating && gpsAccessSegment && gpsAccessSegment.length >= 2
      ? coordsToLineGeoJSON(gpsAccessSegment)
      : null;

  // ---------------------------------------------------------------------------
  // handleMapPress — dismisses the place pin card when the map background is
  // tapped. Alternative route selection is handled by GeoJSONSource onPress
  // (see alt-routes-source below), which delivers features directly without
  // needing queryRenderedFeatures.
  // ---------------------------------------------------------------------------
  function handleMapPress() {
    setPinLocation(null);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1565C0" />

      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        mapStyle={MAP_STYLE}
        attributionPosition={{ bottom: 8, right: 8 }}
        logoPosition={{ bottom: 8, left: 8 }}
        onPress={handleMapPress}
        onRegionWillChange={(e) => {
          // Disengage camera follow when user manually pans
          if (e.nativeEvent?.userInteraction && isFollowingUser) {
            setIsFollowingUser(false);
          }
        }}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{
            // Fixed centre + zoom matches focusCampus() so the idle view is
            // identical whether the map has just mounted or data has reloaded.
            center: [CAMPUS_CENTER_LNG, CAMPUS_CENTER_LAT],
            zoom: 16,
          }}
          minZoom={CAMPUS_MIN_ZOOM}
          maxZoom={CAMPUS_MAX_ZOOM}
          maxBounds={CAMPUS_MAX_BOUNDS}
        />

        {/* Alternative routes (grey). GeoJSONSource onPress delivers the tapped
             feature (with routeIndex) directly — no queryRenderedFeatures needed.
             hitbox widens the touch target to 44 × 44 pt around the line. */}
        {routeOptions.length > 1 && (
          <GeoJSONSource
            id="alt-routes-source"
            data={altRoutesGeoJSON}
            hitbox={{ top: 22, right: 22, bottom: 22, left: 22 }}
            onPress={(e) => {
              const feature = e.nativeEvent.features[0];
              if (!feature) return;
              const routeIndex = (feature.properties as { routeIndex?: number } | null)
                ?.routeIndex;
              if (typeof routeIndex === "number") {
                selectRoute(routeIndex);
                e.stopPropagation(); // don't also fire Map's onPress (would clear pin)
              }
            }}
          >
            <Layer
              id="alt-routes-layer"
              type="line"
              paint={{ "line-color": "#B0B8C1", "line-width": 4 }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </GeoJSONSource>
        )}

        {/* Main/selected route — white casing beneath blue fill.
             Always mounted so React updates data on the existing native source
             rather than registering a new one (which caused the first-click
             render miss). An empty FeatureCollection hides the layers naturally. */}
        <GeoJSONSource id="main-route-source" data={mainRouteGeoJSON}>
          {/* Casing: wider white stroke rendered first (bottom) */}
          <Layer
            id="main-route-casing"
            type="line"
            paint={{ "line-color": "#FFFFFF", "line-width": 9, "line-opacity": 0.9 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
          {/* Fill: blue stroke rendered on top */}
          <Layer
            id="main-route-layer"
            type="line"
            paint={{ "line-color": "#1565C0", "line-width": 5 }}
            layout={{ "line-cap": "round", "line-join": "round" }}
          />
        </GeoJSONSource>

        {/* GPS access segment (dashed orange) */}
        {accessSegmentGeoJSON && (
          <GeoJSONSource id="access-segment-source" data={accessSegmentGeoJSON}>
            <Layer
              id="access-segment-layer"
              type="line"
              paint={{
                "line-color": "#FF6F00",
                "line-width": 3,
                "line-dasharray": [2, 1.5],
              }}
              layout={{ "line-cap": "round", "line-join": "round" }}
            />
          </GeoJSONSource>
        )}

        {/* Start location marker (green) — hidden during NAVIGATING */}
        {startLocation && !isNavigating && (
          <Marker lngLat={[startLocation.longitude, startLocation.latitude]} anchor="bottom">
            <View style={styles.pinMarkerContainer}>
              <View style={[styles.pinMarkerDot, { backgroundColor: "#4CAF50" }]} />
            </View>
          </Marker>
        )}

        {/* End location marker (red) */}
        {endLocation && (
          <Marker lngLat={[endLocation.longitude, endLocation.latitude]} anchor="bottom">
            <View style={styles.pinMarkerContainer}>
              <View style={[styles.pinMarkerDot, { backgroundColor: "#F44336" }]} />
            </View>
          </Marker>
        )}

        {/* Live GPS position marker (blue dot) — only during NAVIGATING */}
        {isNavigating && liveGpsPosition && (
          <Marker lngLat={[liveGpsPosition.longitude, liveGpsPosition.latitude]} anchor="center">
            <View style={styles.gpsMarkerOuter}>
              <View style={styles.gpsMarkerInner} />
            </View>
          </Marker>
        )}

        {/* DEV MODE: road nodes */}
        {DEV_MODE && developerMode && roadNodes.map((node) => {
          const color = locationConnectMode
            ? (selectedRoadNode?.id === node.id ? "#FF6500" : "#1565C0")
            : (selectedNode1?.id === node.id ? "#4CAF50" : selectedNode2?.id === node.id ? "#F44336" : "#1565C0");
          return (
            <Marker
              key={`node-${node.id}`}
              lngLat={[node.longitude, node.latitude]}
              anchor="center"
              onPress={() => selectNode(node)}
            >
              <View style={[styles.devNodeDot, { backgroundColor: color }]} />
            </Marker>
          );
        })}

        {/* DEV MODE: location markers */}
        {DEV_MODE && developerMode && locations.map((location) => (
          <Marker
            key={`loc-${location.id}`}
            lngLat={[location.longitude, location.latitude]}
            anchor="bottom"
            onPress={() => selectLocation(location)}
          >
            <View style={[styles.devNodeDot, { backgroundColor: selectedLocation?.id === location.id ? "#FF6500" : "#9C27B0" }]} />
          </Marker>
        ))}

        {/* Pin location marker */}
        {pinLocation && typeof pinLocation.latitude === "number" && typeof pinLocation.longitude === "number" && (
          <Marker lngLat={[pinLocation.longitude, pinLocation.latitude]} anchor="bottom">
            <View style={styles.pinMarkerContainer}>
              <View style={[styles.pinMarkerDot, { backgroundColor: "#1565C0" }]} />
            </View>
          </Marker>
        )}
      </Map>

      {/* ── All UI overlays in a single absolute container so they render
           above MapLibre's native GL SurfaceView (which sits above normal
           React Native sibling views on Android). pointerEvents="box-none"
           lets the transparent wrapper pass map touches through while still
           delivering touches to interactive children (buttons, cards, etc.). ── */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">

        {/* ── NAVIGATING / ARRIVED overlay — replaces header ── */}
        {(isNavigating || isArrived) && (
          <SafeAreaView edges={["top"]} style={styles.navBarSafeArea}>
            <View style={styles.navBar}>
              {/* Left: destination info */}
              <View style={styles.navBarInfo}>
                {isArrived ? (
                  <>
                    <Ionicons name="checkmark-circle" size={22} color="#4CAF50" style={{ marginRight: 8 }} />
                    <View>
                      <Text style={styles.navBarLabel}>You have arrived!</Text>
                      <Text style={styles.navBarDestination} numberOfLines={1}>
                        {endLocation?.name ?? "Destination"}
                      </Text>
                    </View>
                  </>
                ) : (
                  <>
                    <Ionicons name="navigate-circle" size={22} color="#fff" style={{ marginRight: 8 }} />
                    <View>
                      <Text style={styles.navBarLabel}>Navigating to</Text>
                      <Text style={styles.navBarDestination} numberOfLines={1}>
                        {endLocation?.name ?? "Destination"}
                      </Text>
                    </View>
                  </>
                )}
              </View>

              {/* Right: distance + cancel */}
              <View style={styles.navBarRight}>
                {!isArrived && (
                  <Text style={styles.navBarDistance}>{distanceLabel}</Text>
                )}
                <TouchableOpacity
                  style={styles.cancelNavButton}
                  onPress={cancelNavigation}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close" size={18} color="#fff" />
                  <Text style={styles.cancelNavText}>
                    {isArrived ? "Done" : "Cancel"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Recenter button */}
            {isNavigating && !isFollowingUser && (
              <TouchableOpacity
                style={styles.recenterButton}
                onPress={() => {
                  setIsFollowingUser(true);
                  if (liveGpsPosition) {
                    cameraRef.current?.easeTo({
                      center: [liveGpsPosition.longitude, liveGpsPosition.latitude],
                      zoom: 17,
                      duration: 400,
                    });
                  }
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="locate" size={20} color="#1565C0" />
              </TouchableOpacity>
            )}
          </SafeAreaView>
        )}

        {/* ── Normal route-planning header — hidden during NAVIGATING / ARRIVED ── */}
        {!isNavigating && !isArrived && (
          <SafeAreaView
            edges={["top"]}
            style={styles.headerSafeArea}
            onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
          >
            <View style={styles.titleRow}>
              <TouchableOpacity style={styles.backButton} onPress={handleBack} activeOpacity={0.75}>
                <Ionicons name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Navigate Campus</Text>
              <View style={styles.backButton} />
            </View>

            <View style={styles.controlsGroup}>
              {/* ── Row 1: FROM / TO fields + swap button ── */}
              <View style={styles.fieldsRow}>
                {/* Left: FROM + TO stacked */}
                <View style={styles.fieldsColumn}>
                  {/* FROM */}
                  <TouchableOpacity
                    style={styles.fieldButton}
                    activeOpacity={0.85}
                    onPress={() =>
                      navigation.navigate("LocationPicker", {
                        type: "from",
                        currentTo: endLocation ?? undefined,
                      })
                    }
                  >
                    <View style={[styles.fieldDot, { backgroundColor: "#4CAF50" }]} />
                    <Text style={[styles.fieldText, startLocation ? styles.fieldTextActive : styles.fieldTextPlaceholder]} numberOfLines={1}>
                      {startLocation?.name ?? "Choose starting point"}
                    </Text>
                  </TouchableOpacity>

                  {isCurrentLocationRoute && currentLocationCampusStatus === "outside" && (
                    <Text style={styles.campusWarning}>Current location is outside the campus boundary.</Text>
                  )}

                  {/* TO */}
                  <TouchableOpacity
                    style={styles.fieldButton}
                    activeOpacity={0.85}
                    onPress={() =>
                      navigation.navigate("LocationPicker", {
                        type: "to",
                        currentFrom: startLocation ?? undefined,
                      })
                    }
                  >
                    <View style={[styles.fieldDot, { backgroundColor: "#F44336" }]} />
                    <Text style={[styles.fieldText, endLocation ? styles.fieldTextActive : styles.fieldTextPlaceholder]} numberOfLines={1}>
                      {endLocation?.name ?? "Choose destination"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Right: swap zone */}
                <View style={styles.swapZone}>
                  <TouchableOpacity style={styles.swapButton} onPress={swapFromTo} activeOpacity={0.8}>
                    <Ionicons name="swap-vertical" size={18} color="#1565C0" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* ── Row 2: Find Route ── */}
              <TouchableOpacity
                style={[
                  styles.findRouteButton,
                  isFindingRoute && styles.findRouteButtonDisabled,
                ]}
                onPress={findRoute}
                activeOpacity={0.85}
                disabled={isFindingRoute}
              >
                <Ionicons
                  name="navigate"
                  size={16}
                  color="#1565C0"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.findRouteButtonText}>
                  {isFindingRoute ? "Finding Route…" : "Find Route"}
                </Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        )}



        {/* Developer tools panel */}
        {DEV_MODE && (
          <View style={styles.devPanel}>
            <TouchableOpacity style={[styles.devButton, { backgroundColor: developerMode ? "#2E7D32" : "#757575" }]} onPress={() => setDeveloperMode(!developerMode)}>
              <Text style={styles.devButtonText}>{developerMode ? "Developer Mode ON" : "Developer Mode OFF"}</Text>
            </TouchableOpacity>
            {developerMode && (
              <>
                <TouchableOpacity style={[styles.devButton, { backgroundColor: locationConnectMode ? "#E65100" : "#757575" }]} onPress={() => { setLocationConnectMode(!locationConnectMode); setSelectedNode1(null); setSelectedNode2(null); setSelectedRoadNode(null); setSelectedLocation(null); }}>
                  <Text style={styles.devButtonText}>{locationConnectMode ? "Location Connect ON" : "Location Connect OFF"}</Text>
                </TouchableOpacity>
                {locationConnectMode ? (
                  <TouchableOpacity style={[styles.devButton, { backgroundColor: "#EF6C00" }]} onPress={connectLocation}><Text style={styles.devButtonText}>Connect Location</Text></TouchableOpacity>
                ) : (
                  <TouchableOpacity style={[styles.devButton, { backgroundColor: "#43A047" }]} onPress={connectNodes}><Text style={styles.devButtonText}>Connect Nodes</Text></TouchableOpacity>
                )}
                <Text style={styles.devText}>Node 1: {selectedNode1?.name ?? "None"}</Text>
                <Text style={styles.devText}>Node 2: {selectedNode2?.name ?? "None"}</Text>
                <Text style={styles.devText}>Location: {selectedLocation?.name ?? "None"}</Text>
                <Text style={styles.devText}>Road Node: {selectedRoadNode?.name ?? "None"}</Text>
              </>
            )}
          </View>
        )}

        {/* ── Floating Bottom Card: Route Summary (ROUTE_PREVIEW only) ── */}
        {showBottomCard && (
          <Animated.View style={[styles.bottomCard, { opacity: bottomCardOpacity, transform: [{ translateY: bottomCardTranslateY }] }]}>
            <View style={styles.routeHeaderRow}>
              <View style={styles.routeBadge}>
                <Ionicons name="git-branch-outline" size={14} color="#1565C0" />
                <Text style={styles.routeBadgeText}>{selectedRouteIndex === 0 ? "Shortest Path" : `Route ${selectedRouteIndex + 1}`}</Text>
              </View>
            </View>
            {routeOptions.length > 1 && selectedRouteIndex > 0 && (
              <TouchableOpacity style={styles.shortestPathButton} onPress={() => selectRoute(0)} activeOpacity={0.85}>
                <Ionicons name="git-branch-outline" size={14} color="#1565C0" style={{ marginRight: 6 }} />
                <Text style={styles.shortestPathButtonText}>Return to Shortest Path</Text>
              </TouchableOpacity>
            )}
            <View style={styles.statsRow}>
              <View style={styles.statBlock}>
                <View style={styles.statIconRow}>
                  <MaterialCommunityIcons name="map-marker-distance" size={20} color="#1565C0" />
                  <Text style={styles.statValue}>{distanceLabel}</Text>
                </View>
                <Text style={styles.statLabel}>Distance</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statBlock}>
                <View style={styles.statIconRow}>
                  <MaterialCommunityIcons name="walk" size={20} color="#1565C0" />
                  <Text style={styles.statValue}>{durationLabel}</Text>
                </View>
                <Text style={styles.statLabel}>Walking Time</Text>
              </View>
            </View>
            {isCurrentLocationRoute && (
              <TouchableOpacity style={styles.startNavButton} onPress={startNavigation} activeOpacity={0.85}>
                <Ionicons name="navigate-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                <Text style={styles.startNavButtonText}>Start Navigation</Text>
              </TouchableOpacity>
            )}
          </Animated.View>
        )}

        {/* Place pin info card */}
        {pinLocation && (
          <View style={styles.pinInfoCardWrapper} pointerEvents="box-none">
            <TouchableOpacity style={styles.pinInfoCard} activeOpacity={1} onPress={() => { }}>
              <Text style={styles.pinInfoName} numberOfLines={2}>{pinLocation.name ?? ""}</Text>
              {typeof (pinLocation as any).where === "string" && (pinLocation as any).where.trim() ? (
                <Text style={styles.pinInfoDetail} numberOfLines={2}>{(pinLocation as any).where.trim()}</Text>
              ) : null}
            </TouchableOpacity>
          </View>
        )}


        {/* ── Finding-route bottom panel — shown while GPS fix is in progress ── */}
        <FindingRoutePanel
          visible={isFindingRoute}
          onCancel={() => setIsFindingRoute(false)}
          label={
            from === "current-location"
              ? "Getting your location…"
              : "Calculating route…"
          }
        />

      </View>{/* end overlay container */}
    </View>
  );
}

const BLUE_PRIMARY = "#1565C0";
const BLUE_LIGHT = "#1976D2";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f4f8" },

  // -- Blue Header --------------------------------------------------------------
  headerSafeArea: {
    backgroundColor: BLUE_PRIMARY,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 8,
    elevation: 10,
  },

  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
  },

  backButton: { width: 38, height: 38, borderRadius: 19, justifyContent: "center", alignItems: "center" },

  headerTitle: { flex: 1, textAlign: "center", fontSize: 20, fontWeight: "700", color: "#fff", letterSpacing: 0.3 },

  // -- Controls group -----------------------------------------------------------
  controlsGroup: {
    flexDirection: "column",
    marginHorizontal: 14,
    marginBottom: 14,
    backgroundColor: "rgba(255,255,255,0.13)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },

  fieldsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },

  fieldsColumn: {
    flex: 1,
    gap: 8,
  },

  fieldButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 10,
  },

  fieldDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },

  fieldText: { flex: 1, fontSize: 14 },
  fieldTextPlaceholder: { color: "#BDBDBD", fontWeight: "400" },
  fieldTextActive: { color: "#1A1A2E", fontWeight: "600" },

  campusWarning: { color: "#FFCDD2", fontSize: 11, marginLeft: 4, lineHeight: 15 },

  swapZone: {
    width: 46,
    alignItems: "center",
    paddingTop: 26,
    paddingLeft: 8,
  },
  swapButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },

  findRouteButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    backgroundColor: "#fff", borderRadius: 10, paddingVertical: 11,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2,
  },
  findRouteButtonText: { color: BLUE_PRIMARY, fontWeight: "700", fontSize: 14, letterSpacing: 0.3 },
  findRouteButtonDisabled: { opacity: 0.55 },



  // -- Navigation Bar (NAVIGATING / ARRIVED state) ------------------------------
  navBarSafeArea: {
    backgroundColor: BLUE_PRIMARY,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 12,
  },
  navBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navBarInfo: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 12,
  },
  navBarLabel: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.3,
  },
  navBarDestination: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  navBarRight: {
    alignItems: "flex-end",
    gap: 6,
  },
  navBarDistance: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    opacity: 0.9,
  },
  cancelNavButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  cancelNavText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  recenterButton: {
    position: "absolute",
    right: 16,
    bottom: -56,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 8,
  },

  // -- Bottom Floating Card -----------------------------------------------------
  bottomCard: {
    position: "absolute", left: 14, right: 14, bottom: 28,
    backgroundColor: "#fff", borderRadius: 20, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 12, elevation: 10,
  },

  // -- Place pin info card -------------------------------------------------------
  pinInfoCardWrapper: { position: "absolute", left: 14, right: 14, bottom: 65 },
  pinInfoCard: {
    backgroundColor: "#FFFFFF", borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: "#0F172A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.14, shadowRadius: 12, elevation: 10,
    gap: 4, borderLeftWidth: 4, borderLeftColor: "#1565C0",
  },
  pinInfoName: { fontSize: 16, fontWeight: "700", color: "#1E293B", letterSpacing: -0.1, lineHeight: 22 },
  pinInfoDetail: { fontSize: 13, color: "#64748B", fontWeight: "500", lineHeight: 18 },

  // -- Route summary internals --------------------------------------------------
  routeHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  routeBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "#EBF2FF", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  routeBadgeText: { fontSize: 12, fontWeight: "700", color: BLUE_PRIMARY, letterSpacing: 0.2 },
  shortestPathButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: BLUE_PRIMARY, borderRadius: 10,
    paddingVertical: 8, marginBottom: 12, backgroundColor: "#EBF2FF",
  },
  shortestPathButtonText: { color: BLUE_PRIMARY, fontSize: 12, fontWeight: "700" },
  statsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", marginBottom: 16, paddingHorizontal: 8 },
  statBlock: { alignItems: "center", flex: 1 },
  statIconRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 3 },
  statDivider: { width: 1, height: 36, backgroundColor: "#E8ECF0" },
  statValue: { fontSize: 20, fontWeight: "800", color: "#1A1A2E" },
  statLabel: { fontSize: 11, color: "#9E9E9E", fontWeight: "500", textTransform: "uppercase", letterSpacing: 0.5 },
  startNavButton: {
    backgroundColor: BLUE_LIGHT, flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 13, borderRadius: 12, elevation: 3,
    shadowColor: BLUE_LIGHT, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6,
  },
  startNavButtonText: { color: "#fff", fontWeight: "700", fontSize: 15, letterSpacing: 0.3 },

  // -- Developer Panel ----------------------------------------------------------
  devPanel: {
    position: "absolute", top: 300, left: 16, right: 16, backgroundColor: "#fff",
    borderRadius: 16, padding: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, elevation: 6,
  },
  devButton: { backgroundColor: "#757575", padding: 12, borderRadius: 8, alignItems: "center", marginTop: 8 },
  devButtonText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  devText: { fontSize: 13, color: "#424242", marginTop: 6 },

  // -- Marker styles ------------------------------------------------------------
  pinMarkerContainer: {
    width: 24,
    height: 24,
    justifyContent: "center",
    alignItems: "center",
  },
  pinMarkerDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  devNodeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: "#fff",
  },

  // -- Live GPS marker ----------------------------------------------------------
  gpsMarkerOuter: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(21, 101, 192, 0.25)",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  gpsMarkerInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#1565C0",
  },
});