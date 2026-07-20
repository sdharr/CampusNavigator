import { Graph } from "./graphService";

// ---------------------------------------------------------------------------
// Low-level helpers (unchanged from original)
// ---------------------------------------------------------------------------

function edgeKey(from: string, to: string) {
  return `${from}\0${to}`;
}

function pathKey(path: string[]) {
  return path.join("\0");
}

function getPathDistance(graph: Graph, path: string[]) {
  let totalDistance = 0;

  for (let index = 0; index < path.length - 1; index++) {
    const edgeDistance = (graph[path[index]] ?? []).reduce(
      (smallestDistance, candidate) =>
        candidate.node === path[index + 1] &&
        candidate.distance < smallestDistance
          ? candidate.distance
          : smallestDistance,
      Infinity
    );

    if (!Number.isFinite(edgeDistance)) {
      return Infinity;
    }

    totalDistance += edgeDistance;
  }

  return totalDistance;
}

function findShortestAllowedPath(
  graph: Graph,
  start: string,
  end: string,
  blockedNodes: Set<string>,
  blockedEdges: Set<string>
) {
  if (blockedNodes.has(start) || blockedNodes.has(end)) {
    return [];
  }

  const distances: Record<string, number> = {};
  const previous: Record<string, string | null> = {};
  const visited = new Set<string>();

  for (const nodeId in graph) {
    if (!blockedNodes.has(nodeId)) {
      distances[nodeId] = Infinity;
      previous[nodeId] = null;
    }
  }

  if (!(start in distances) || !(end in distances)) {
    return [];
  }

  distances[start] = 0;

  while (true) {
    let current: string | null = null;
    let smallestDistance = Infinity;

    for (const nodeId in distances) {
      if (!visited.has(nodeId) && distances[nodeId] < smallestDistance) {
        current = nodeId;
        smallestDistance = distances[nodeId];
      }
    }

    if (current === null || current === end) {
      break;
    }

    visited.add(current);

    for (const edge of graph[current] ?? []) {
      if (
        blockedNodes.has(edge.node) ||
        blockedEdges.has(edgeKey(current, edge.node))
      ) {
        continue;
      }

      const newDistance = distances[current] + edge.distance;
      if (newDistance < distances[edge.node]) {
        distances[edge.node] = newDistance;
        previous[edge.node] = current;
      }
    }
  }

  if (!Number.isFinite(distances[end])) {
    return [];
  }

  const path: string[] = [];
  let current: string | null = end;

  while (current) {
    path.unshift(current);
    current = previous[current];
  }

  return path;
}

// ---------------------------------------------------------------------------
// Diversity metric
// ---------------------------------------------------------------------------

/**
 * Jaccard similarity on the interior node sets of two paths (start/end
 * are excluded because they are always shared).
 *
 * Returns a value in [0, 1]:
 *   1.0  → identical interior nodes
 *   0.0  → completely disjoint interior nodes
 */
function pathSimilarity(pathA: string[], pathB: string[]): number {
  const setA = new Set(pathA.slice(1, -1));
  const setB = new Set(pathB.slice(1, -1));

  // Two single-hop paths (no interior nodes) are always treated as identical.
  if (setA.size === 0 && setB.size === 0) return 1.0;

  let intersection = 0;
  for (const n of setA) {
    if (setB.has(n)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Finds diverse alternative routes between the same start and destination.
 *
 * Algorithm (node-blocking + Jaccard diversity filtering):
 *
 * 1. Accept the Dijkstra-shortest primary path as route 0.
 *
 * 2. First exploration pass — block each interior node of the primary path
 *    one at a time and re-run the constrained Dijkstra.  Blocking a node
 *    that lies on one side of the campus forces the search to route through
 *    the opposite side, naturally revealing clockwise/anticlockwise branches.
 *
 * 3. Filter near-duplicates with Jaccard similarity.  A candidate whose
 *    interior-node Jaccard similarity with any already-accepted path exceeds
 *    SIMILARITY_THRESHOLD is discarded.  Candidates are evaluated in
 *    shortest-first order so the best diverse option wins each slot.
 *
 * 4. Second exploration pass — repeat step 2 using the interior nodes of
 *    each newly accepted alternative.  This reaches further branches that
 *    are not discoverable by blocking primary-path nodes alone.
 *
 * 5. Sort all accepted routes by graph-edge distance (shortest first).
 *    The primary path is always index 0 because it is already the global
 *    shortest path returned by Dijkstra; node-blocked variants can only be
 *    equal or longer.
 *
 * 6. Return up to maxRoutes paths.
 *
 * Nothing in this function mutates the graph or any Firebase data.
 */
export function findAlternativeRoutes(
  graph: Graph,
  primaryPath: string[],
  maxRoutes = 5
): string[][] {
  if (primaryPath.length < 2) {
    return primaryPath.length === 0 ? [] : [primaryPath];
  }

  const start = primaryPath[0];
  const end = primaryPath[primaryPath.length - 1];
  const primaryDistance = getPathDistance(graph, primaryPath);

  if (!Number.isFinite(primaryDistance)) {
    return [primaryPath];
  }

  // Two paths sharing more than this fraction of interior nodes are treated
  // as near-duplicates and the cheaper one is kept.
  const SIMILARITY_THRESHOLD = 0.5;

  // Track paths we have already seen to skip exact duplicates cheaply.
  const seenKeys = new Set<string>([pathKey(primaryPath)]);

  // Accepted diverse routes, always sorted shortest-first at the end.
  const accepted: { path: string[]; distance: number }[] = [
    { path: primaryPath, distance: primaryDistance },
  ];

  /**
   * Block each interior node of `sourcePath` in turn, discover the
   * constrained-shortest path, and greedily add diverse candidates to
   * `accepted`.
   */
  function exploreByBlocking(sourcePath: string[]): void {
    const interiorNodes = sourcePath.slice(1, -1);
    const newCandidates: { path: string[]; distance: number }[] = [];

    for (const blockedNode of interiorNodes) {
      const altPath = findShortestAllowedPath(
        graph,
        start,
        end,
        new Set([blockedNode]),
        new Set<string>()
      );

      if (altPath.length < 2) continue;

      const key = pathKey(altPath);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);

      const dist = getPathDistance(graph, altPath);
      if (Number.isFinite(dist)) {
        newCandidates.push({ path: altPath, distance: dist });
      }
    }

    // Evaluate shortest candidates first so the most efficient diverse
    // route wins each available slot.
    newCandidates.sort((a, b) => a.distance - b.distance);

    for (const candidate of newCandidates) {
      if (accepted.length >= maxRoutes) break;

      const tooSimilar = accepted.some(
        (acc) => pathSimilarity(acc.path, candidate.path) > SIMILARITY_THRESHOLD
      );

      if (!tooSimilar) {
        accepted.push(candidate);
      }
    }
  }

  // Pass 1: explore from the primary (Dijkstra shortest) path.
  exploreByBlocking(primaryPath);

  // Pass 2: explore from each alternative found in pass 1.
  // Snapshot the count so we don't iterate over paths added in pass 2.
  const afterPass1 = accepted.length;
  for (let i = 1; i < afterPass1 && accepted.length < maxRoutes; i++) {
    exploreByBlocking(accepted[i].path);
  }

  // Sort by graph-edge distance — the primary path stays at index 0.
  accepted.sort((a, b) => a.distance - b.distance);

  return accepted.map((r) => r.path);
}
