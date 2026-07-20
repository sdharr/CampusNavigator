export interface CampusCoordinate {
  latitude: number;
  longitude: number;
}

// The campus perimeter is separate from the Firestore road-routing graph.
// The final polygon edge closes automatically from P17 back to P1.
export const CAMPUS_BOUNDARY: CampusCoordinate[] = [
  { latitude: 32.721962, longitude: 74.871541 }, // P1
  { latitude: 32.719798, longitude: 74.874249 }, // P2
  { latitude: 32.719495, longitude: 74.874481 }, // P3
  { latitude: 32.719272, longitude: 74.874484 }, // P4
  { latitude: 32.718074, longitude: 74.873832 }, // P5
  { latitude: 32.714148, longitude: 74.870336 }, // P6
  { latitude: 32.714063, longitude: 74.870054 }, // P7
  { latitude: 32.716323, longitude: 74.866432 }, // P8
  { latitude: 32.718063, longitude: 74.863086 }, // P9
  { latitude: 32.718674, longitude: 74.862848 }, // P10
  { latitude: 32.718879, longitude: 74.862607 }, // P11
  { latitude: 32.719547, longitude: 74.863199 }, // P12
  { latitude: 32.720232, longitude: 74.863762 }, // P13
  { latitude: 32.720466, longitude: 74.864303 }, // P14
  { latitude: 32.720671, longitude: 74.864615 }, // P15
  { latitude: 32.721107, longitude: 74.865724 }, // P16
  { latitude: 32.72186, longitude: 74.868389 }, // P17
];

const EPSILON = 1e-10;

function isPointOnBoundary(
  latitude: number,
  longitude: number,
  start: CampusCoordinate,
  end: CampusCoordinate
) {
  const crossProduct =
    (longitude - start.longitude) * (end.latitude - start.latitude) -
    (latitude - start.latitude) * (end.longitude - start.longitude);

  if (Math.abs(crossProduct) > EPSILON) {
    return false;
  }

  return (
    latitude >= Math.min(start.latitude, end.latitude) - EPSILON &&
    latitude <= Math.max(start.latitude, end.latitude) + EPSILON &&
    longitude >= Math.min(start.longitude, end.longitude) - EPSILON &&
    longitude <= Math.max(start.longitude, end.longitude) + EPSILON
  );
}

/**
 * Returns true when a GPS coordinate is inside the campus perimeter or lies
 * directly on it. Uses ray casting and closes the final edge from P17 to P1.
 */
export function isInsideCampus(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  let isInside = false;

  for (
    let currentIndex = 0, previousIndex = CAMPUS_BOUNDARY.length - 1;
    currentIndex < CAMPUS_BOUNDARY.length;
    previousIndex = currentIndex++
  ) {
    const current = CAMPUS_BOUNDARY[currentIndex];
    const previous = CAMPUS_BOUNDARY[previousIndex];

    if (isPointOnBoundary(latitude, longitude, previous, current)) {
      return true;
    }

    const crossesLatitude =
      (current.latitude > latitude) !== (previous.latitude > latitude);

    if (crossesLatitude) {
      const intersectionLongitude =
        ((previous.longitude - current.longitude) *
          (latitude - current.latitude)) /
          (previous.latitude - current.latitude) +
        current.longitude;

      if (longitude < intersectionLongitude) {
        isInside = !isInside;
      }
    }
  }

  return isInside;
}
