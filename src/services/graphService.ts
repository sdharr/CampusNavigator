import { getRoadEdges, RoadEdge } from "./roadEdgeService";
import { getLocationRoadEdges, LocationRoadEdge } from "./locationRoadEdgeService";

export interface GraphEdge {
  node: string;
  distance: number;
}

export type Graph = {
  [nodeId: string]: GraphEdge[];
};

// ---------------------------------------------------------------------------
// Pure (synchronous) graph builder — accepts already-fetched data.
// Used by campusDataService so that Firestore is only hit once.
// ---------------------------------------------------------------------------
export function buildGraphFromData(
  roadEdges: RoadEdge[],
  locationEdges: LocationRoadEdge[]
): Graph {
  const graph: Graph = {};

  function ensureNode(nodeId: string) {
    if (!graph[nodeId]) {
      graph[nodeId] = [];
    }
  }

  // road_edges are already stored bidirectionally in Firestore
  // (addRoadEdge writes both forward and reverse documents)
  for (const edge of roadEdges) {
    ensureNode(edge.from);
    graph[edge.from].push({
      node: edge.to,
      distance: edge.distance,
    });
  }

  // location_road_edges are stored as a single document per connection
  // so we add both directions here in the graph builder
  for (const edge of locationEdges) {
    ensureNode(edge.locationId);
    ensureNode(edge.roadNodeId);

    // Location → Road network (user departing from a named place)
    graph[edge.locationId].push({
      node: edge.roadNodeId,
      distance: edge.distance,
    });

    // Road network → Location (user arriving at a named place)
    graph[edge.roadNodeId].push({
      node: edge.locationId,
      distance: edge.distance,
    });
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Async wrapper kept for backward compatibility with any call sites that
// still need to fetch + build in one shot (e.g. standalone scripts).
// ---------------------------------------------------------------------------
export async function buildGraph(): Promise<Graph> {
  const roadEdges: RoadEdge[] = await getRoadEdges();
  const locationEdges: LocationRoadEdge[] = await getLocationRoadEdges();
  return buildGraphFromData(roadEdges, locationEdges);
}