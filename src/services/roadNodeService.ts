import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export interface RoadNode {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
}

export async function getRoadNodes(): Promise<RoadNode[]> {
  const snapshot = await getDocs(collection(db, "road_nodes"));

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as Omit<RoadNode, "id">),
  }));
}