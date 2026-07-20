import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Image } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Ionicons } from "@expo/vector-icons";


export default function HomeScreen({ navigation }: any) {
  return (
    <View style={styles.container}>
<View
  style={{
    position: "relative",
    alignItems: "center",
    marginBottom: 30,
  }}
>
  {/* Building */}
  <Image
    source={require("../assets/ju2.png")}
    style={{
      width: "100%",
      height: 100,
      resizeMode: "cover",
      opacity: 0,
    }}
  />

  {/* Logo */}
  <Image
    source={require("../assets/ju3.png")}
    style={{
      width: 200,
      height: 200,
      resizeMode: "contain",
      position: "absolute",
      top: -60
    }}
  />
</View>
      
      {/* <Image
        source={require("../assets/ju3.png")}
        style={{
          width: 200,
          height: 200,
          resizeMode: "contain",
          alignSelf: "center",
          marginBottom: 10,
        }}
      />
      <Image
        source={require("../assets/ju2.png")}
        style={{
          width: "100%",
          height: 100,
          resizeMode: "cover",
          opacity: 0.5,
          marginTop: -20,
          marginBottom: 20,
        }}
      /> */}

      <Text style={styles.title}>
        Jammu University
      </Text>
      <Text style={styles.maintitle}>
        Campus Navigator
      </Text>


      <Text style={styles.subtitle}>
       Find your way around Jammu University
      </Text>

      {/* <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("Map")}
      >
        <Text style={styles.buttonText}>
          🗺️ Navigate Campus
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.button}
        onPress={() => navigation.navigate("PlaceInfo")}
      >
        <Text style={styles.buttonText}>
          🏛️ Place Information
        </Text>
      </TouchableOpacity> */}
      <TouchableOpacity
  style={styles.card}
  onPress={() => navigation.navigate("Map")}
>
  <View style={styles.cardLeft}>
    <View style={styles.iconCircle}>
  <MaterialCommunityIcons
    name="map-marker-path"
    size={28}
    color="#1565C0"
  />
</View>

    <View style={{ marginLeft: 16 }}>
      <Text style={styles.cardTitle}>
        Navigate Campus
      </Text>

      <Text style={styles.cardSubtitle}>
        Find shortest path
      </Text>
    </View>
  </View>

  
  <Ionicons
    name="chevron-forward"
    size={22}
    color="white"
  />

</TouchableOpacity>

      <TouchableOpacity
  style={styles.card}
  onPress={() => navigation.navigate("PlaceInfo")}
>
  <View style={styles.cardLeft}>
      <View style={styles.iconCircle}>
  <MaterialCommunityIcons
   name="office-building"
    size={28}
    color="#1565C0"
  />
</View>

    <View style={{ marginLeft: 16 }}>
      <Text style={styles.cardTitle}>
        Place Information
      </Text>

      <Text style={styles.cardSubtitle}>
        Explore campus Places
      </Text> 
    </View>
  </View>

  <Ionicons
    name="chevron-forward"
    size={22}
    color="white"
  />

</TouchableOpacity>

    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    padding: 25,
    backgroundColor: "#F5F7FB",
  },

  emoji: {
    fontSize: 60,
    textAlign: "center",
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    fontWeight: "bold",
    textAlign: "center",
    color: "black",
  },
  maintitle: {
    textAlign: "center",
    fontSize: 36,
    fontWeight: "800",
    color: "#0A3D91",
  },

  subtitle: {
    textAlign: "center",
    color: "#666",
    marginTop: 10,
    marginBottom: 30,
    fontSize: 15,
    lineHeight: 22,

  },
 

  button: {
    backgroundColor: "#184a7b",
    paddingVertical: 18,
    borderRadius: 15,
    marginBottom: 20,
    elevation: 3,
  },

  buttonText: {
    color: "white",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "600",
  },
card: {
  backgroundColor: "#1565C0",
  borderRadius: 22,
  padding: 22,
  marginTop: 18,

  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",

  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowRadius: 10,
  shadowOffset: {
    width: 0,
    height: 6,
  },

  elevation: 8,
},

cardLeft: {
  flexDirection: "row",
  alignItems: "center",
},

cardTitle: {
  color: "white",
  fontSize: 20,
  fontWeight: "800",
},

cardSubtitle: {
  color: "rgba(255,255,255,0.85)",
  fontSize: 14,
  marginTop: 4,
},
iconCircle: {
  width: 52,
  height: 52,
  borderRadius: 28,
  backgroundColor: "white",

  justifyContent: "center",
  alignItems: "center",
},

});