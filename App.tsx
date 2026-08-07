import AppNavigator from "./src/navigation/AppNavigator";
import { CampusDataProvider } from "./src/context/CampusDataContext";

export default function App() {
  return (
    <CampusDataProvider>
      <AppNavigator />
    </CampusDataProvider>
  );
}