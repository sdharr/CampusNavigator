import { addDoc, collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export interface LocationRoadEdge {
  id: string;
  locationId: string;
  roadNodeId: string;
  distance: number;
}

export async function addLocationRoadEdge(
  locationId: string,
  roadNodeId: string,
  distance: number
): Promise<void> {
  await addDoc(collection(db, "location_road_edges"), {
    locationId,
    roadNodeId,
    distance,
  });
}

export async function getLocationRoadEdges(): Promise<LocationRoadEdge[]> {
  const snapshot = await getDocs(collection(db, "location_road_edges"));

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<LocationRoadEdge, "id">),
  }));
}
