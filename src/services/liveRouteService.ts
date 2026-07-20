import { Graph } from "./graphService";
import { RoadNode } from "./roadNodeService";

/**
 * The ephemeral virtual node ID used to represent the user's live GPS position
 * inside the routing graph. This key is NEVER written to Firestore; it exists
 * only for the duration of a single Dijkstra computation.
 */
export const GPS_VIRTUAL_NODE_ID = "__gps__";

// ---------------------------------------------------------------------------
// Geometry helper
// ---------------------------------------------------------------------------

/**
 * Haversine great-circle distance between two GPS coordinates, in metres.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000; // Earth radius in metres
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Inside-campus: nearest road node
// ---------------------------------------------------------------------------

/**
 * Returns the nearest road node to the given GPS position that is within
 * maxRadiusMeters. Returns null if no node qualifies.
 */
export function findNearestRoadNode(
  gpsLat: number,
  gpsLon: number,
  roadNodes: RoadNode[],
  maxRadiusMeters: number
): RoadNode | null {
  let nearest: RoadNode | null = null;
  let nearestDist = Infinity;

  for (const node of roadNodes) {
    const dist = haversineDistance(gpsLat, gpsLon, node.latitude, node.longitude);
    if (dist <= maxRadiusMeters && dist < nearestDist) {
      nearestDist = dist;
      nearest = node;
    }
  }

  return nearest;
}

// ---------------------------------------------------------------------------
// Virtual graph builder
// ---------------------------------------------------------------------------

/**
 * Returns a shallow-cloned copy of baseGraph with a temporary GPS virtual node
 * connected bidirectionally to connectToNodeId at the given distance.
 *
 * Rules:
 * - The original baseGraph object is NOT mutated.
 * - The returned graph must be used only for in-memory routing; it must never
 *   be persisted to Firestore.
 */
export function buildVirtualGraph(
  baseGraph: Graph,
  connectToNodeId: string,
  distanceMeters: number
): Graph {
  // Shallow clone — existing neighbour arrays are not mutated
  const virtualGraph: Graph = { ...baseGraph };

  // Ensure the target node has an entry
  const existingEdges = virtualGraph[connectToNodeId] ?? [];

  // GPS -> connection node
  virtualGraph[GPS_VIRTUAL_NODE_ID] = [
    { node: connectToNodeId, distance: distanceMeters },
  ];

  // Connection node -> GPS  (copy existing edges, append GPS edge)
  virtualGraph[connectToNodeId] = [
    ...existingEdges,
    { node: GPS_VIRTUAL_NODE_ID, distance: distanceMeters },
  ];

  return virtualGraph;
}
