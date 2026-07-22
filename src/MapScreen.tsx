import { useEffect, useRef, useState } from "react";
import {
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
import { buildGraph, Graph } from "./services/graphService";
import { dijkstra } from "./services/dijkstraService";
import { findAlternativeRoutes } from "./services/alternativeRouteService";
import MapView, { Marker, Polyline } from "react-native-maps";
import { addRoadEdge } from "./services/roadEdgeService";
import { getLocations } from "./services/locationService";
import {
  getRoadNodes,
  RoadNode,
} from "./services/roadNodeService";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CampusLocation, RootStackParamList } from "./navigation/AppNavigator";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { isInsideCampus } from "./constants/campusBoundary";
import * as ExpoLocation from "expo-location";
import {
  haversineDistance,
  findNearestRoadNode,
  buildVirtualGraph,
  GPS_VIRTUAL_NODE_ID,
} from "./services/liveRouteService";

// Toggle developer/editing tools for the whole screen.
// When false, all dev-only UI is hidden but the underlying
// functions (connectNodes, connectLocation, etc.) are untouched.
const DEV_MODE = false;

// ---------------------------------------------------------------------------
// Live GPS routing configuration
// ---------------------------------------------------------------------------
/** Minimum GPS movement (metres) before a full Dijkstra recalculation runs. */
const GPS_RECALC_THRESHOLD_METERS = 15;
/** Max snap distance (metres) when connecting GPS to a road node inside campus. */
const GPS_MAX_INSIDE_RADIUS_METERS = 300;
/** Distance (metres) to the destination that triggers the ARRIVED state. */
const ARRIVAL_THRESHOLD_METERS = 20;

// ---------------------------------------------------------------------------
// Navigation phase state machine
// ---------------------------------------------------------------------------
/**
 * The four discrete states the navigation session can be in.
 *
 *  IDLE          → no route selected; only location-picker UI visible
 *  ROUTE_PREVIEW → a route has been calculated and is shown; user can choose
 *                  a route variant or tap "Start Navigation"
 *  NAVIGATING    → live GPS watcher is active; compact nav-bar replaces header
 *  ARRIVED       → user is within ARRIVAL_THRESHOLD_METERS of destination
 */
enum NavigationPhase {
  IDLE = "IDLE",
  ROUTE_PREVIEW = "ROUTE_PREVIEW",
  NAVIGATING = "NAVIGATING",
  ARRIVED = "ARRIVED",
}

type Props = NativeStackScreenProps<RootStackParamList, "Map">;

export default function MapScreen({ route, navigation }: Props) {
  const mapRef = useRef<MapView>(null);

  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [roadNodes, setRoadNodes] = useState<RoadNode[]>([]);
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
  // Navigation phase — single source of truth replacing isLiveNavigating
  // ---------------------------------------------------------------------------
  const [navPhase, setNavPhase] = useState<NavigationPhase>(NavigationPhase.IDLE);

  const bottomCardAnim = useRef(new Animated.Value(0)).current;
  const [headerHeight, setHeaderHeight] = useState(Platform.OS === "android" ? 220 : 240);

  // Whether the map should follow the user's position during NAVIGATING.
  // Set to false when the user manually pans the map.
  const [isFollowingUser, setIsFollowingUser] = useState(false);

  // -- Live GPS watcher refs (never stored in Firestore) ---------------------
  const locationWatcherRef = useRef<ExpoLocation.LocationSubscription | null>(null);
  /** The graph node ID that the live GPS is currently connected to. */
  const connectionNodeIdRef = useRef<string | null>(null);
  /** Coordinates of the current connection node. */
  const connectionNodeCoordRef = useRef<{ latitude: number; longitude: number } | null>(null);
  /** Firestore location ID of the active destination during live routing. */
  const destinationRef = useRef<string | null>(null);
  /** True when the GPS session started with the user outside the campus. */
  const isOutsideCampusRef = useRef<boolean>(false);
  /** Last GPS position used for movement-threshold checks. */
  const lastGpsRef = useRef<{ latitude: number; longitude: number } | null>(null);
  /**
   * Stable ref to the road-nodes array so the GPS watcher callback is never
   * operating on a stale closure. Updated whenever roadNodes state changes.
   */
  const roadNodesRef = useRef<RoadNode[]>([]);

  // Keep roadNodesRef in sync with state
  useEffect(() => {
    roadNodesRef.current = roadNodes;
  }, [roadNodes]);

  useEffect(() => { loadData(); }, []);

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

  // ---------------------------------------------------------------------------
  // Handle incoming route.params from LocationPickerScreen
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const params = route.params;
    if (!params) return;

    if (params.intent === "from") {
      const loc = params.location;
      setFrom(loc.id);
      setStartLocation(loc);
      if (loc.id === "current-location") {
        const isInside = isInsideCampus(loc.latitude, loc.longitude);
        setCurrentLocationCampusStatus(isInside ? "inside" : "outside");
        // Clear any previous route so the user taps Find Route to recompute
        setRouteCoordinates([]);
        setRouteDistanceMeters(null);
        setRouteDurationMinutes(null);
        setNavPhase(NavigationPhase.IDLE);
      } else {
        setCurrentLocationCampusStatus(null);
      }
      // Restore the preserved TO endpoint so both coexist in state
      if (params.preservedTo) {
        setTo(params.preservedTo.id);
        setEndLocation(params.preservedTo);
      }
    } else if (params.intent === "to") {
      const loc = params.location;
      setTo(loc.id);
      setEndLocation(loc);
      // Restore the preserved FROM endpoint so both coexist in state
      if (params.preservedFrom) {
        setFrom(params.preservedFrom.id);
        setStartLocation(params.preservedFrom);
      }
    } else if (params.intent === "pin") {
      const loc = params.location;
      setPinLocation(loc);
      if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
        mapRef.current?.animateToRegion(
          { latitude: loc.latitude, longitude: loc.longitude, latitudeDelta: 0.001, longitudeDelta: 0.001 },
          1000
        );
      }
    }
  }, [route.params]);

  async function loadData() {
    try {
      const locationData = (await getLocations()) as CampusLocation[];
      setLocations(locationData);
      const nodeData = await getRoadNodes();
      setRoadNodes(nodeData);
      roadNodesRef.current = nodeData;
      const graph = await buildGraph();
      graphRef.current = graph;
      console.log("GRAPH:", graph);
      console.log("Road Nodes:", nodeData);
      const coordMap: Record<string, { latitude: number; longitude: number }> = {};
      for (const loc of locationData) { coordMap[loc.id] = { latitude: loc.latitude, longitude: loc.longitude }; }
      for (const node of nodeData) { coordMap[node.id] = { latitude: node.latitude, longitude: node.longitude }; }
      coordinateMapRef.current = coordMap;

      // If opened with a pin intent from PlaceDetailScreen, focus on it after data loads
      const params = route.params;
      if (params?.intent === "pin") {
        const loc = params.location;
        setPinLocation(loc as CampusLocation);
        if (typeof loc.latitude === "number" && typeof loc.longitude === "number") {
          mapRef.current?.animateToRegion(
            { latitude: loc.latitude, longitude: loc.longitude, latitudeDelta: 0.001, longitudeDelta: 0.001 },
            800
          );
        }
      }
    } catch (error) { console.log(error); }
  }

  function focusCampus() {
    mapRef.current?.animateToRegion({ latitude: 32.716289, longitude: 74.866404, latitudeDelta: 0.003, longitudeDelta: 0.003 }, 1000);
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

  function displayRoute(coords: { latitude: number; longitude: number }[]) {
    setRouteCoordinates(coords);
    computeRouteStats(coords);
    if (mapRef.current && coords.length > 0) {
      mapRef.current.fitToCoordinates(coords, { edgePadding: { top: 260, left: 60, right: 60, bottom: 220 }, animated: true });
    }
  }

  function selectRoute(index: number) {
    const selectedRoute = routeOptions[index];
    if (!selectedRoute) return;
    setSelectedRouteIndex(index);
    setRouteCoordinates(selectedRoute);
    // Include the GPS access segment in stats and map fit when active
    if (gpsAccessSegment && gpsAccessSegment.length >= 2) {
      const fullCoords = [gpsAccessSegment[0], ...selectedRoute];
      computeRouteStats(fullCoords);
      if (mapRef.current && fullCoords.length > 0) {
        mapRef.current.fitToCoordinates(fullCoords, {
          edgePadding: { top: 260, left: 60, right: 60, bottom: 220 },
          animated: true,
        });
      }
    } else {
      displayRoute(selectedRoute);
    }
  }

  // ---------------------------------------------------------------------------
  // Helper: find a valid connection node for a GPS position inside campus.
  // Tries the nearest road node; if that node is not in the graph, walks
  // outward through sorted candidates until one is found.
  // ---------------------------------------------------------------------------
  function findValidConnectionNode(
    gpsLat: number,
    gpsLon: number,
    nodes: RoadNode[],
    graph: Graph
  ): { id: string; coord: { latitude: number; longitude: number } } | null {
    // Sort all nodes by distance from GPS
    const sorted = [...nodes]
      .map((n) => ({
        node: n,
        dist: haversineDistance(gpsLat, gpsLon, n.latitude, n.longitude),
      }))
      .filter((e) => e.dist <= GPS_MAX_INSIDE_RADIUS_METERS)
      .sort((a, b) => a.dist - b.dist);

    // Return the first node that actually exists in the graph (has edges)
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
  // findRoute — calculates the campus route and shows a preview
  // ---------------------------------------------------------------------------
  async function findRoute() {
    if (!from || !to) {
      Alert.alert("Missing Selection", "Please select both locations.");
      return;
    }

    const isCurrentLocation = from === "current-location" && startLocation?.id === "current-location";

    if (isCurrentLocation) {
      // ── Current Location branch: get a fresh GPS fix before routing ──────
      try {
        const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Needed", "Allow location access to calculate the route.");
          return;
        }

        // Get a fresh position — High accuracy for reliable road-node snapping
        let pos: ExpoLocation.LocationObject;
        try {
          pos = await ExpoLocation.getCurrentPositionAsync({
            accuracy: ExpoLocation.Accuracy.High,
          });
        } catch {
          // Fall back to Balanced if High accuracy times out (common on some Android)
          pos = await ExpoLocation.getCurrentPositionAsync({
            accuracy: ExpoLocation.Accuracy.Balanced,
          });
        }

        const gpsLat = pos.coords.latitude;
        const gpsLon = pos.coords.longitude;
        const gpsCoord = { latitude: gpsLat, longitude: gpsLon };

        // Update startLocation with the fresh coordinate
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

        let connNodeId: string;
        let connNodeCoord: { latitude: number; longitude: number };

        if (!isInside) {
          // ── Outside campus: route via the "Main Gate" Firestore location ──
          const mainGate = locations.find((loc) => loc.name === "Main Gate");
          if (!mainGate) {
            Alert.alert(
              "Entrance Not Found",
              "Could not find the 'Main Gate' location. Please ensure it exists in Firestore."
            );
            clearRoute();
            return;
          }
          if (!graphRef.current[mainGate.id]) {
            Alert.alert(
              "Entrance Not Connected",
              "The Main Gate location is not yet connected to the campus road graph."
            );
            clearRoute();
            return;
          }
          connNodeId = mainGate.id;
          connNodeCoord = { latitude: mainGate.latitude, longitude: mainGate.longitude };
        } else {
          // ── Inside campus: snap to nearest graph-connected road node ─────
          const connection = findValidConnectionNode(
            gpsLat,
            gpsLon,
            roadNodesRef.current,
            graphRef.current
          );
          if (!connection) {
            Alert.alert(
              "No Road Node Nearby",
              `You are inside the campus but no road node was found within ${GPS_MAX_INSIDE_RADIUS_METERS} m. Try moving closer to a campus road.`
            );
            clearRoute();
            return;
          }
          connNodeId = connection.id;
          connNodeCoord = connection.coord;
        }

        const accessDist = haversineDistance(gpsLat, gpsLon, connNodeCoord.latitude, connNodeCoord.longitude);
        const virtualGraph = buildVirtualGraph(graphRef.current, connNodeId, accessDist);

        // Temporarily inject GPS coords for path ID → coordinate resolution
        coordinateMapRef.current[GPS_VIRTUAL_NODE_ID] = gpsCoord;
        const path = dijkstra(virtualGraph, GPS_VIRTUAL_NODE_ID, to);
        const routePaths = findAlternativeRoutes(virtualGraph, path);
        delete coordinateMapRef.current[GPS_VIRTUAL_NODE_ID];

        if (path.length < 2) {
          Alert.alert(
            "No Route Found",
            "Could not find a route from your location to the destination. Make sure the destination is connected to the road network."
          );
          clearRoute();
          return;
        }

        // Campus portion = path after the virtual GPS node (connection → destination)
        const campusPath = path.slice(1);
        const campusCoords = campusPath
          .map((id) => coordinateMapRef.current[id])
          .filter(Boolean) as { latitude: number; longitude: number }[];

        // Alternative campus portions (same access segment, different campus paths)
        const altCampusOptions = routePaths
          .slice(1)
          .map((altPath) =>
            altPath
              .slice(1)
              .map((id) => coordinateMapRef.current[id])
              .filter(Boolean) as { latitude: number; longitude: number }[]
          )
          .filter((coords) => coords.length >= 1);

        const allRouteOptions = [campusCoords, ...altCampusOptions];
        setRouteOptions(allRouteOptions);
        setSelectedRouteIndex(0);
        setRouteCoordinates(campusCoords);
        setNavPhase(NavigationPhase.ROUTE_PREVIEW);

        // Stats include the full route: access segment + campus route
        computeRouteStats([gpsCoord, ...campusCoords]);

        // Fit map to show the complete route including GPS origin
        const allVisibleCoords = [gpsCoord, ...campusCoords];
        if (mapRef.current && allVisibleCoords.length > 0) {
          mapRef.current.fitToCoordinates(allVisibleCoords, {
            edgePadding: { top: 260, left: 60, right: 60, bottom: 220 },
            animated: true,
          });
        }

        // Persist connection snapshot in refs so startNavigation() can reference them.
        // The live watcher is NOT started here — only startNavigation() does that.
        connectionNodeIdRef.current = connNodeId;
        connectionNodeCoordRef.current = connNodeCoord;
        destinationRef.current = to;
        isOutsideCampusRef.current = !isInside;
        lastGpsRef.current = gpsCoord;
        return;
      } catch (error) {
        console.log("findRoute GPS error:", error);
        Alert.alert("GPS Error", "Could not obtain your current location. Please try again.");
        return;
      }
    }

    // ── Normal campus→campus route (no GPS involved) ──────────────────────────
    const end = locations.find((item) => item.id === to) || null;
    setEndLocation(end);

    const path = dijkstra(graphRef.current, from, to);
    if (path.length < 2) {
      Alert.alert("No Route Found", "Could not find a route between these locations. Make sure both locations are connected to the road network.");
      clearRoute();
      return;
    }
    const routePaths = findAlternativeRoutes(graphRef.current, path);
    const pathCoordinates = path.map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[];
    const alternativeRouteCoordinates = routePaths.slice(1).map((routePath) => {
      const coordinates = routePath.map((id) => coordinateMapRef.current[id]).filter(Boolean) as { latitude: number; longitude: number }[];
      return coordinates.length === routePath.length ? coordinates : null;
    }).filter((coordinates): coordinates is { latitude: number; longitude: number }[] => coordinates !== null);
    const availableRouteOptions = [pathCoordinates, ...alternativeRouteCoordinates];
    setRouteOptions(availableRouteOptions);
    setSelectedRouteIndex(0);
    setNavPhase(NavigationPhase.ROUTE_PREVIEW);
    displayRoute(pathCoordinates);
  }

  // ---------------------------------------------------------------------------
  // startNavigation — transitions from ROUTE_PREVIEW → NAVIGATING
  //
  // This is the ONLY place where:
  //   - a fresh High-accuracy GPS fix is obtained
  //   - the blue live GPS marker becomes visible
  //   - the orange access segment is rendered
  //   - the live GPS watcher is started
  //   - the camera zooms to the user's current position
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
      // 1. Permission
      const { status } = await ExpoLocation.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission Needed", "Allow location access to start navigation.");
        return;
      }

      // 2. Fresh High-accuracy GPS fix
      let pos: ExpoLocation.LocationObject;
      try {
        pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.High,
        });
      } catch {
        pos = await ExpoLocation.getCurrentPositionAsync({
          accuracy: ExpoLocation.Accuracy.Balanced,
        });
      }
      const gpsLat = pos.coords.latitude;
      const gpsLon = pos.coords.longitude;
      const gpsCoord = { latitude: gpsLat, longitude: gpsLon };

      const isInside = isInsideCampus(gpsLat, gpsLon);
      setCurrentLocationCampusStatus(isInside ? "inside" : "outside");

      // 3. Determine connection node
      let connNodeId: string;
      let connNodeCoord: { latitude: number; longitude: number };

      if (!isInside) {
        const mainGate = locations.find((loc) => loc.name === "Main Gate");
        if (!mainGate) {
          Alert.alert("Entrance Not Found", "Could not find the 'Main Gate' location. Please ensure it exists in Firestore.");
          return;
        }
        if (!graphRef.current[mainGate.id]) {
          Alert.alert("Entrance Not Connected", "The Main Gate location is not yet connected to the campus road graph.");
          return;
        }
        connNodeId = mainGate.id;
        connNodeCoord = { latitude: mainGate.latitude, longitude: mainGate.longitude };
      } else {
        const connection = findValidConnectionNode(
          gpsLat,
          gpsLon,
          roadNodesRef.current,
          graphRef.current
        );
        if (!connection) {
          Alert.alert(
            "No Road Node Nearby",
            `You are inside the campus but no road node was found within ${GPS_MAX_INSIDE_RADIUS_METERS} m.`
          );
          return;
        }
        connNodeId = connection.id;
        connNodeCoord = connection.coord;
      }

      // 4. Build virtual graph and run Dijkstra from fresh GPS position
      const accessDist = haversineDistance(gpsLat, gpsLon, connNodeCoord.latitude, connNodeCoord.longitude);
      const virtualGraph = buildVirtualGraph(graphRef.current, connNodeId, accessDist);

      coordinateMapRef.current[GPS_VIRTUAL_NODE_ID] = gpsCoord;
      const path = dijkstra(virtualGraph, GPS_VIRTUAL_NODE_ID, to);
      const routePaths = findAlternativeRoutes(virtualGraph, path);
      delete coordinateMapRef.current[GPS_VIRTUAL_NODE_ID];

      if (path.length < 2) {
        Alert.alert(
          "No Route Found",
          "Could not compute a live route to the destination. Make sure the destination is connected to the road network."
        );
        return;
      }

      const campusPath = path.slice(1);
      const campusCoords = campusPath
        .map((id) => coordinateMapRef.current[id])
        .filter(Boolean) as { latitude: number; longitude: number }[];

      const altCampusOptions = routePaths
        .slice(1)
        .map((altPath) =>
          altPath
            .slice(1)
            .map((id) => coordinateMapRef.current[id])
            .filter(Boolean) as { latitude: number; longitude: number }[]
        )
        .filter((c) => c.length >= 1);

      // 5. Transition to NAVIGATING — this is the moment the blue dot appears
      setRouteOptions([campusCoords, ...altCampusOptions]);
      setSelectedRouteIndex(0);
      setRouteCoordinates(campusCoords);
      setGpsAccessSegment([gpsCoord, connNodeCoord]);
      setLiveGpsPosition(gpsCoord);
      setNavPhase(NavigationPhase.NAVIGATING);
      setIsFollowingUser(true);
      computeRouteStats([gpsCoord, ...campusCoords]);

      // 6. Animate camera to user's GPS position at navigation zoom level
      // (professional navigation UX: start zoomed in on the user, not the whole route)
      mapRef.current?.animateToRegion(
        {
          latitude: gpsLat,
          longitude: gpsLon,
          latitudeDelta: 0.002,
          longitudeDelta: 0.002,
        },
        800
      );

      // 7. Persist refs for the watcher
      connectionNodeIdRef.current = connNodeId;
      connectionNodeCoordRef.current = connNodeCoord;
      destinationRef.current = to;
      isOutsideCampusRef.current = !isInside;
      lastGpsRef.current = gpsCoord;

      // 8. Start the live GPS watcher — only here
      startLiveGpsWatcher();
    } catch (error) {
      console.log("startNavigation error:", error);
      Alert.alert("Error", "Could not start navigation. Please try again.");
    }
  }

  // ---------------------------------------------------------------------------
  // cancelNavigation — transitions NAVIGATING/ARRIVED → ROUTE_PREVIEW
  // ---------------------------------------------------------------------------
  function cancelNavigation() {
    stopLiveGpsWatcher();
    setGpsAccessSegment(null);
    setLiveGpsPosition(null);
    setIsFollowingUser(false);
    connectionNodeIdRef.current = null;
    connectionNodeCoordRef.current = null;
    lastGpsRef.current = null;
    // Return to ROUTE_PREVIEW if a route is still shown, otherwise IDLE
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
    stopLiveGpsWatcher(); // ensure no stale subscription
    try {
      const sub = await ExpoLocation.watchPositionAsync(
        {
          accuracy: ExpoLocation.Accuracy.High,
          distanceInterval: 5, // fire every >=5 m of movement
        },
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

    // Always update the live GPS marker and the access segment head
    setLiveGpsPosition(newGps);
    setGpsAccessSegment([newGps, connNodeCoord]);

    // ── Arrival check ─────────────────────────────────────────────────────────
    const destCoord = coordinateMapRef.current[destId];
    if (destCoord) {
      const distToDest = haversineDistance(
        newGps.latitude,
        newGps.longitude,
        destCoord.latitude,
        destCoord.longitude
      );
      if (distToDest < ARRIVAL_THRESHOLD_METERS) {
        stopLiveGpsWatcher();
        setGpsAccessSegment(null);
        setRouteCoordinates([]);
        setNavPhase(NavigationPhase.ARRIVED);
        return;
      }
    }

    // ── Camera follow (only if user hasn't manually panned) ──────────────────
    if (isFollowingUser) {
      mapRef.current?.animateToRegion(
        {
          latitude: newGps.latitude,
          longitude: newGps.longitude,
          latitudeDelta: 0.002,
          longitudeDelta: 0.002,
        },
        300
      );
    }

    // ── Movement threshold ────────────────────────────────────────────────────
    const last = lastGpsRef.current;
    const moved = last
      ? haversineDistance(last.latitude, last.longitude, newGps.latitude, newGps.longitude)
      : Infinity;
    lastGpsRef.current = newGps;

    if (isOutsideCampusRef.current) {
      // Outside campus: Main Gate is a fixed entrance — access segment update above suffices
      return;
    }

    // Inside campus: only re-run Dijkstra if user moved far enough
    if (moved < GPS_RECALC_THRESHOLD_METERS) {
      return;
    }

    // Find nearest GRAPH-CONNECTED road node at new position
    const connection = findValidConnectionNode(
      newGps.latitude,
      newGps.longitude,
      roadNodesRef.current,  // use ref, not stale state closure
      graphRef.current
    );
    if (!connection) return; // No node in range — keep existing route

    // If the connection node hasn't changed, the segment update above suffices
    if (connection.id === connNodeId) return;

    // New connection node — rebuild virtual graph and re-run Dijkstra
    const newConnNodeCoord = connection.coord;
    const accessDist = haversineDistance(
      newGps.latitude,
      newGps.longitude,
      newConnNodeCoord.latitude,
      newConnNodeCoord.longitude
    );
    const virtualGraph = buildVirtualGraph(graphRef.current, connection.id, accessDist);

    coordinateMapRef.current[GPS_VIRTUAL_NODE_ID] = newGps;
    const path = dijkstra(virtualGraph, GPS_VIRTUAL_NODE_ID, destId);
    delete coordinateMapRef.current[GPS_VIRTUAL_NODE_ID];

    if (path.length < 2) return; // No valid path — keep existing

    const campusPath = path.slice(1);
    const campusCoords = campusPath
      .map((id) => coordinateMapRef.current[id])
      .filter(Boolean) as { latitude: number; longitude: number }[];

    // Update connection refs and route
    connectionNodeIdRef.current = connection.id;
    connectionNodeCoordRef.current = newConnNodeCoord;
    setGpsAccessSegment([newGps, newConnNodeCoord]);
    setRouteCoordinates(campusCoords);
    computeRouteStats([newGps, ...campusCoords]);
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

  // Swap from / to (real state swap)
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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1565C0" />

      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={{ latitude: 32.716289, longitude: 74.866404, latitudeDelta: 0.001, longitudeDelta: 0.001 }}
        onMapReady={focusCampus}
        onPress={() => setPinLocation(null)}
        onPanDrag={() => {
          // User manually panned — disengage camera follow
          if (isFollowingUser) setIsFollowingUser(false);
        }}
      >
        {/* Start location marker — suppressed during NAVIGATING (live GPS dot takes over) */}
        {startLocation && !isNavigating && (
          <Marker coordinate={{ latitude: startLocation.latitude, longitude: startLocation.longitude }} title={startLocation.name} description={startLocation.description} pinColor="green" />
        )}
        {endLocation && (
          <Marker coordinate={{ latitude: endLocation.latitude, longitude: endLocation.longitude }} title={endLocation.name} description={endLocation.description} pinColor="red" />
        )}
        {routeOptions.map((coordinates, index) =>
          index !== selectedRouteIndex && (
            <Polyline key={`alternative-route-${index}`} coordinates={coordinates} strokeColor="#B0B8C1" strokeWidth={4} tappable onPress={() => selectRoute(index)} zIndex={1} />
          )
        )}
        {routeCoordinates.length > 0 && (
          <Polyline coordinates={routeCoordinates} strokeColor="#1565C0" strokeWidth={5} lineDashPattern={undefined} zIndex={2} />
        )}
        {/* GPS access segment — dashed amber line from live position to connection node.
             Only rendered during active live navigation (NAVIGATING). */}
        {isNavigating && gpsAccessSegment && gpsAccessSegment.length >= 2 && (
          <Polyline
            coordinates={gpsAccessSegment}
            strokeColor="#FF6F00"
            strokeWidth={3}
            lineDashPattern={[10, 6]}
            zIndex={3}
          />
        )}
        {/* Live GPS position marker — blue pulsing dot.
             Must NOT appear before the user taps "Start Navigation".
             Gated on NAVIGATING so no stale/snapshot coordinate is ever shown. */}
        {isNavigating && liveGpsPosition && (
          <Marker
            coordinate={liveGpsPosition}
            anchor={{ x: 0.5, y: 0.5 }}
            title="You are here"
            zIndex={10}
          >
            <View style={styles.gpsMarkerOuter}>
              <View style={styles.gpsMarkerInner} />
            </View>
          </Marker>
        )}
        {DEV_MODE && developerMode && roadNodes.map((node) => {
          const color = locationConnectMode ? (selectedRoadNode?.id === node.id ? "orange" : "blue") : (selectedNode1?.id === node.id ? "green" : selectedNode2?.id === node.id ? "red" : "blue");
          return <Marker key={`${node.id}-${color}`} coordinate={{ latitude: node.latitude, longitude: node.longitude }} title={node.name} pinColor={color} onPress={() => selectNode(node)} />;
        })}
        {DEV_MODE && developerMode && locations.map((location) => (
          <Marker key={location.id} coordinate={{ latitude: location.latitude, longitude: location.longitude }} title={location.name} description="Location" pinColor={selectedLocation?.id === location.id ? "orange" : "purple"} zIndex={1000} onPress={() => selectLocation(location)} />
        ))}
        {pinLocation && typeof pinLocation.latitude === "number" && typeof pinLocation.longitude === "number" && (
          <Marker coordinate={{ latitude: pinLocation.latitude, longitude: pinLocation.longitude }} title={pinLocation.name ?? ""} pinColor="#1565C0" onPress={(e) => { e.stopPropagation(); }} />
        )}
      </MapView>

      {/* ── NAVIGATING / ARRIVED overlay — replaces header during active navigation ── */}
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

          {/* Recenter button — reappears when user has manually panned away */}
          {isNavigating && !isFollowingUser && (
            <TouchableOpacity
              style={styles.recenterButton}
              onPress={() => {
                setIsFollowingUser(true);
                if (liveGpsPosition) {
                  mapRef.current?.animateToRegion(
                    {
                      latitude: liveGpsPosition.latitude,
                      longitude: liveGpsPosition.longitude,
                      latitudeDelta: 0.002,
                      longitudeDelta: 0.002,
                    },
                    400
                  );
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
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.75}>
              <Ionicons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Navigate Campus</Text>
            <View style={styles.backButton} />
          </View>

          {/*
            Column layout inside controlsGroup:
              Row 1 (fieldsRow): fieldsColumn (flex:1) + swapZone (fixed 46px)
              Row 2: findRouteButton — full width of controlsGroup
          */}
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
                      // Pass current TO so LocationPicker can echo it back
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
                      // Pass current FROM so LocationPicker can echo it back
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

              {/* Right: swap zone — button centred at FROM/TO boundary */}
              <View style={styles.swapZone}>
                <TouchableOpacity style={styles.swapButton} onPress={swapFromTo} activeOpacity={0.8}>
                  <Ionicons name="swap-vertical" size={18} color="#1565C0" />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── Row 2: Find Route — full width of controlsGroup ── */}
            <TouchableOpacity style={styles.findRouteButton} onPress={findRoute} activeOpacity={0.85}>
              <Ionicons name="navigate" size={16} color="#1565C0" style={{ marginRight: 6 }} />
              <Text style={styles.findRouteButtonText}>Find Route</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* Walking pill — floats just below the header (hidden during navigation) */}
      {!isNavigating && !isArrived && (
        <View style={[styles.walkingPillWrapper, { top: headerHeight + 12 }]}>
          <TouchableOpacity style={styles.walkingPill} activeOpacity={0.85}>
            <MaterialCommunityIcons name="walk" size={18} color="#1565C0" />
            <Text style={styles.walkingPillText}>Walking</Text>
            <Ionicons name="chevron-forward" size={14} color="#1565C0" style={{ marginLeft: 2 }} />
          </TouchableOpacity>
        </View>
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

  // -- Walking Pill -------------------------------------------------------------
  walkingPillWrapper: { position: "absolute", left: 14 },
  walkingPill: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, gap: 6,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 5, elevation: 5,
  },
  walkingPillText: { color: "#1A1A2E", fontWeight: "600", fontSize: 13 },

  // -- Navigation Bar (NAVIGATING / ARRIVED state) --------------------------------
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
  pinInfoRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  pinInfoIconWrap: { width: 38, height: 38, borderRadius: 12, backgroundColor: "#EAF2FF", justifyContent: "center", alignItems: "center", flexShrink: 0 },
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

  // -- Live GPS marker --------------------------------------------------------
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
