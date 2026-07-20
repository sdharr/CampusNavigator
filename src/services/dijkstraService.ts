import { Graph } from "./graphService";

export function dijkstra(
  graph: Graph,
  start: string,
  end: string
): string[] {
  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const visited = new Set<string>();

  // Initialize all nodes
  for (const node in graph) {
    distances[node] = Infinity;
    previous[node] = null;
  }

  distances[start] = 0;

  while (true) {
    let current: string | null = null;
    let smallest = Infinity;

    // Find closest unvisited node
    for (const node in distances) {
      if (!visited.has(node) && distances[node] < smallest) {
        smallest = distances[node];
        current = node;
      }
    }

    if (current === null) break;

    if (current === end) break;

    visited.add(current);

    for (const neighbor of graph[current]) {
      const newDistance =
        distances[current] + neighbor.distance;

      if (newDistance < distances[neighbor.node]) {
        distances[neighbor.node] = newDistance;
        previous[neighbor.node] = current;
      }
    }
  }

  const path: string[] = [];

  let current: string | null = end;

  while (current) {
    path.unshift(current);
    current = previous[current];
  }

  return path;
}