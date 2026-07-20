// import { collection, getDocs } from "firebase/firestore";
// import { db } from "./firebase";
// export async function getLocations() {
//   return [
//     {
//       id: "1",
//       name: "Main Gate",
//       latitude: 32.716289,
//       longitude: 74.866404,
//       description: "Test",
//     },
//   ];
// }


import { collection, getDocs } from "firebase/firestore";
import { db } from "./firebase";

export async function getLocations() {
  const snapshot = await getDocs(collection(db, "locations"));

  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
}
