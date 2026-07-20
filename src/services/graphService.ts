import { getRoadEdges, RoadEdge } from "./roadEdgeService";
import { getLocationRoadEdges, LocationRoadEdge } from "./locationRoadEdgeService";

export interface GraphEdge {
  node: string;
  distance: number;
}

export type Graph = {
  [nodeId: string]: GraphEdge[];
};

export async function buildGraph(): Promise<Graph> {
  const roadEdges: RoadEdge[] = await getRoadEdges();
  const locationEdges: LocationRoadEdge[] = await getLocationRoadEdges();

  const graph: Graph = {};

  // Helper to safely initialise a node in the graph
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