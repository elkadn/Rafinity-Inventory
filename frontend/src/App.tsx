import type { ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import LoginPage from "./pages/LoginPage";
import ScannerPage from "./pages/ScannerPage";
import AdminPage from "./pages/AdminPage";

function RequireAuth({ children }: { children: ReactNode }) {
  const { token, isLoading } = useAuth();
  if (isLoading) return <FullScreenLoading />;
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "admin") return <Navigate to="/scan" replace />;
  return <>{children}</>;
}

function FullScreenLoading() {
  return (
    <div
      className="app-shell"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100dvh",
        color: "var(--color-text-muted)",
        fontWeight: 600,
      }}
    >
      Chargement…
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/scan"
            element={
              <RequireAuth>
                <ScannerPage />
              </RequireAuth>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
          <Route path="*" element={<Navigate to="/scan" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
