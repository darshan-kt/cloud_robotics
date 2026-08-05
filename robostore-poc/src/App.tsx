import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/ui/Toast";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { AppStorePage } from "./pages/AppStorePage";
import { DashboardPage } from "./pages/DashboardPage";
import { EmergencyStopPage } from "./pages/EmergencyStopPage";
import { RemoteControllerPage } from "./pages/RemoteControllerPage";
import { SimpleRoutePlannerPage } from "./pages/SimpleRoutePlannerPage";

// All four mission-deck apps are real pages now (ComingSoonPage.tsx is kept
// in the tree, unused here, in case a future app gets proposed and needs a
// placeholder route again - see robostore-poc/README.md).
export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            path="/store"
            element={
              <ProtectedRoute>
                <AppStorePage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <DashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/emergency-stop"
            element={
              <ProtectedRoute>
                <EmergencyStopPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/remote-controller"
            element={
              <ProtectedRoute>
                <RemoteControllerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/simple-route-planner"
            element={
              <ProtectedRoute>
                <SimpleRoutePlannerPage />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/store" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
