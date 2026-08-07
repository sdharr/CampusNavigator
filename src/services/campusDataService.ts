/**
 * campusDataService.ts
 *
 * Singleton that loads ALL campus Firestore data exactly once per app session.
 * Every screen that needs locations, road nodes, or the routing graph must
 * consume data through this service instead of issuing its own Firestore reads.
 *
 * Usage:
 *   // At app startup (inside CampusDataProvider):
 *   await initializeCampusData();
 *
 *   // Inside any screen (synchronous — data is guaranteed ready):
 *   const { locations, roadNodes, graph, coordinateMap } = getCampusData();
 */

import { getLocations } from "./locationService";
import { getRoadNodes, RoadNode } from "./roadNodeService";
import { getRoadEdges } from "./roadEdgeService";
import { getLocationRoadEdges } from "./locationRoadEdgeService";
import { buildGraphFromData, Graph } from "./graphService";
import { CampusLocation } from "../navigation/AppNavigator";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InitTimings {
  locationsFetchMs: number;
  roadNodesFetchMs: number;
  roadEdgesFetchMs: number;
  locationEdgesFetchMs: number;
  buildGraphMs: number;
  totalMs: number;
}

export interface CampusData {
  locations: CampusLocation[];
  roadNodes: RoadNode[];
  graph: Graph;
  /** Unified id → {latitude, longitude} map for both locations and road nodes. */
  coordinateMap: Record<string, { latitude: number; longitude: number }>;
  timings: InitTimings;
}

// ---------------------------------------------------------------------------
// Module-level singleton state
// ---------------------------------------------------------------------------

let _cache: CampusData | null = null;
let _initPromise: Promise<void> | null = null;

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------

async function timed<T>(
  label: string,
  fn: () => Promise<T>
): Promise<{ result: T; ms: number }> {
  const start = Date.now();
  const result = await fn();
  const ms = Date.now() - start;
  console.log(`[INIT] ${label}: ${ms}ms`);
  return { result, ms };
}

// ---------------------------------------------------------------------------
// Core initializer (private)
// ---------------------------------------------------------------------------

async function _doInit(): Promise<void> {
  const totalStart = Date.now();

  console.log("[INIT] Starting campus data initialization...");

  // Fire all four Firestore reads in parallel.
  // Total time = slowest single read, not the sum.
  const [
    locResult,
    nodesResult,
    edgesResult,
    locEdgesResult,
  ] = await Promise.all([
    timed("locations fetch", () => getLocations() as Promise<CampusLocation[]>),
    timed("road_nodes fetch", () => getRoadNodes()),
    timed("road_edges fetch", () => getRoadEdges()),
    timed("location_road_edges fetch", () => getLocationRoadEdges()),
  ]);

  // Build the routing graph in-memory (CPU only — no more Firestore calls).
  const graphStart = Date.now();
  const graph = buildGraphFromData(edgesResult.result, locEdgesResult.result);
  const buildGraphMs = Date.now() - graphStart;
  console.log(`[INIT] buildGraph (CPU): ${buildGraphMs}ms`);

  // Build unified coordinate lookup map.
  const coordinateMap: Record<string, { latitude: number; longitude: number }> = {};
  for (const loc of locResult.result) {
    coordinateMap[loc.id] = { latitude: loc.latitude, longitude: loc.longitude };
  }
  for (const node of nodesResult.result) {
    coordinateMap[node.id] = { latitude: node.latitude, longitude: node.longitude };
  }

  const totalMs = Date.now() - totalStart;

  const timings: InitTimings = {
    locationsFetchMs: locResult.ms,
    roadNodesFetchMs: nodesResult.ms,
    roadEdgesFetchMs: edgesResult.ms,
    locationEdgesFetchMs: locEdgesResult.ms,
    buildGraphMs,
    totalMs,
  };

  console.log(
    `[INIT] ✓ Initialization complete in ${totalMs}ms\n` +
    `       locations: ${locResult.result.length} docs (${locResult.ms}ms)\n` +
    `       road_nodes: ${nodesResult.result.length} docs (${nodesResult.ms}ms)\n` +
    `       road_edges: ${edgesResult.result.length} docs (${edgesResult.ms}ms)\n` +
    `       location_road_edges: ${locEdgesResult.result.length} docs (${locEdgesResult.ms}ms)\n` +
    `       buildGraph (CPU): ${buildGraphMs}ms\n` +
    `       graph nodes: ${Object.keys(graph).length}\n` +
    `       coordinateMap keys: ${Object.keys(coordinateMap).length}`
  );

  _cache = {
    locations: locResult.result,
    roadNodes: nodesResult.result,
    graph,
    coordinateMap,
    timings,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Kicks off (or joins an already-running) initialization.
 * Safe to call multiple times — will only ever issue one set of Firestore reads.
 */
export async function initializeCampusData(): Promise<void> {
  if (_cache) return; // Already done
  if (_initPromise) return _initPromise; // Already in progress
  _initPromise = _doInit();
  return _initPromise;
}

/**
 * Returns the cached campus data synchronously.
 * Must only be called after `initializeCampusData()` has resolved.
 * Throws a clear error if called too early (should never happen in practice
 * because CampusDataProvider gates all screens behind the loading screen).
 */
export function getCampusData(): CampusData {
  if (!_cache) {
    throw new Error(
      "[CampusDataService] getCampusData() called before initialization completed. " +
      "This is a programming error — ensure CampusDataProvider wraps the navigator."
    );
  }
  return _cache;
}

/**
 * Returns true once initialization has completed successfully.
 */
export function isCampusDataReady(): boolean {
  return _cache !== null;
}
