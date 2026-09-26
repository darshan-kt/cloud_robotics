import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { RemoteDataPage } from "./pages/RemoteDataPage";
import { useAuth } from "./hooks/useAuth";

// Two routes: a login screen and the one app behind it.
//
// INTERN TASK (security): this guard is CLIENT-SIDE ONLY. It hides the UI,
// it does not protect anything — the WebSockets and REST endpoints it
// renders are reachable directly with curl or wscat, signed in or not. Try
// it: `wscat -c ws://localhost:8001/ws/int_api` with no token works fine.
// Route guards are a UX affordance; authorisation belongs on the server.

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/remote-data"
          element={
            <RequireAuth>
              <RemoteDataPage />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/remote-data" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
