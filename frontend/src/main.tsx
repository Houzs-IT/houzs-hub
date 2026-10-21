import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import BoardPage from "./pages/BoardPage";
import IssuePage from "./pages/IssuePage";
import AccountPage from "./pages/AccountPage";
import ListPage from "./pages/ListPage";
import LoginPage from "./pages/LoginPage";
import NotificationsPage from "./pages/NotificationsPage";
import HealthPage from "./pages/HealthPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import ReportsPage from "./pages/ReportsPage";
import RolesPage from "./pages/RolesPage";
import UsersPage from "./pages/UsersPage";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/tickets" replace />} />
          <Route path="/tickets" element={<ListPage />} />
          <Route path="/board" element={<BoardPage />} />
          <Route path="/queue" element={<ListPage queue />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/tickets/:code" element={<IssuePage />} />
          <Route path="/users" element={<UsersPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
