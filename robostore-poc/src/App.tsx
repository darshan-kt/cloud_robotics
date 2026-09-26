import type { ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/ui/Toast";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";

// Robot control
import { AppStorePage } from "./pages/AppStorePage";
import { DashboardPage } from "./pages/DashboardPage";
import { EmergencyStopPage } from "./pages/EmergencyStopPage";
import { RemoteControllerPage } from "./pages/RemoteControllerPage";
import { SimpleRoutePlannerPage } from "./pages/SimpleRoutePlannerPage";

// Robot sensors
import { SensorsDeckPage } from "./pages/SensorsDeckPage";
import { AstraPage } from "./pages/sensors/AstraPage";
import { RplidarPage } from "./pages/sensors/RplidarPage";
import { ImuPage } from "./pages/sensors/ImuPage";
import { UltrasonicPage } from "./pages/sensors/UltrasonicPage";

// Robotics projects
import { ProjectsDeckPage } from "./pages/ProjectsDeckPage";
import { LineFollowingPage } from "./pages/projects/LineFollowingPage";
import { ObjectTrackingPage } from "./pages/projects/ObjectTrackingPage";
import { HumanFollowerPage } from "./pages/projects/HumanFollowerPage";
import { PatrollingPage } from "./pages/projects/PatrollingPage";

// AI & robotics
import { AiDeckPage } from "./pages/AiDeckPage";
import { UniformPage } from "./pages/ai/UniformPage";
import { ExponentialPage } from "./pages/ai/ExponentialPage";
import { NormalPage } from "./pages/ai/NormalPage";
import { Ros2McpPage } from "./pages/ai/Ros2McpPage";
import { PromptingPage } from "./pages/ai/PromptingPage";

// ---------------------------------------------------------------------------
// Route table. Four sections, twenty-one routes.
//
// The paths here are the same strings the catalog (src/lib/appCatalog.ts)
// declares, because the rail and the section decks link from the catalog. A
// route present here but missing there is unreachable; the reverse throws at
// import time, because every reference page resolves itself through
// appMeta(), which fails loudly on an unregistered route rather than
// rendering a page with no header.
// ---------------------------------------------------------------------------

/** Every route below the login screen is gated identically. */
function guard(element: ReactElement) {
  return <ProtectedRoute>{element}</ProtectedRoute>;
}

const ROUTES: Array<[string, ReactElement]> = [
  // -- Robot control -------------------------------------------------------
  ["/control", <AppStorePage />],
  ["/dashboard", <DashboardPage />],
  ["/remote-controller", <RemoteControllerPage />],
  ["/simple-route-planner", <SimpleRoutePlannerPage />],
  ["/emergency-stop", <EmergencyStopPage />],

  // -- Robot sensors -------------------------------------------------------
  ["/sensors", <SensorsDeckPage />],
  ["/sensors/astra", <AstraPage />],
  ["/sensors/rplidar", <RplidarPage />],
  ["/sensors/imu", <ImuPage />],
  ["/sensors/ultrasonic", <UltrasonicPage />],

  // -- Robotics projects ---------------------------------------------------
  ["/projects", <ProjectsDeckPage />],
  ["/projects/line-following", <LineFollowingPage />],
  ["/projects/object-tracking", <ObjectTrackingPage />],
  ["/projects/human-follower", <HumanFollowerPage />],
  ["/projects/patrolling", <PatrollingPage />],

  // -- AI & robotics -------------------------------------------------------
  ["/ai", <AiDeckPage />],
  ["/ai/distributions/uniform", <UniformPage />],
  ["/ai/distributions/exponential", <ExponentialPage />],
  ["/ai/distributions/normal", <NormalPage />],
  ["/ai/driven/ros2-mcp", <Ros2McpPage />],
  ["/ai/driven/prompting", <PromptingPage />],
];

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {ROUTES.map(([path, element]) => (
            <Route key={path} path={path} element={guard(element)} />
          ))}

          {/* The deck moved from /store to /control when the four tools became
              one section of four. Kept as a redirect so existing bookmarks and
              the sign-in redirect still land somewhere real. */}
          <Route path="/store" element={<Navigate to="/control" replace />} />
          <Route path="*" element={<Navigate to="/control" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
