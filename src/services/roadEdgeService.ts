import { addDoc, collection } from "firebase/firestore";
import { db } from "./firebase";
import { getDocs } from "firebase/firestore";
export async function addRoadEdge(
  from: string,
  to: string,
  distance: number
) {
  // Forward edge
  await addDoc(collection(db, "road_edges"), {
    from,
    to,
    distance,
  });

  // Reverse edge
  await addDoc(collection(db, "road_edges"), {
    from: to,
    to: from,
    distance,
  });
}
export interface RoadEdge {
  id: string;
  from: string;
  to: string;
  distance: number;
}

export async function getRoadEdges(): Promise<RoadEdge[]> {
  const snapshot = await getDocs(collection(db, "road_edges"));

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<RoadEdge, "id">),
  }));
}