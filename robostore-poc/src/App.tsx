import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LayoutDashboard, OctagonX, Route as RouteIcon, Smartphone } from "lucide-react";
import { ToastProvider } from "./components/ui/Toast";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { AppStorePage } from "./pages/AppStorePage";
import { ComingSoonPage } from "./pages/ComingSoonPage";

// Each app-store card routes to a real page once it's been proposed and
// built; until then it lands on ComingSoonPage so nothing is a dead link.
// Swap one `<Route>` at a time as apps get built - see robostore-poc/README.md.
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
                <ComingSoonPage title="Dashboard" icon={LayoutDashboard} iconColor="text-emerald-400" tag="Core" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/emergency-stop"
            element={
              <ProtectedRoute>
                <ComingSoonPage title="Emergency Stop" icon={OctagonX} iconColor="text-rose-400" tag="Safety" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/remote-controller"
            element={
              <ProtectedRoute>
                <ComingSoonPage title="Remote Controller" icon={Smartphone} iconColor="text-purple-400" tag="Manual" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/simple-route-planner"
            element={
              <ProtectedRoute>
                <ComingSoonPage
                  title="Simple Route Planner"
                  icon={RouteIcon}
                  iconColor="text-amber-400"
                  tag="Planning"
                />
              </ProtectedRoute>
            }
          />

          <Route path="*" element={<Navigate to="/store" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
