import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, FilePlus2, FileSearch, ShieldCheck, Bell, UserRound, PackagePlus, Boxes, ListChecks,
  GitCompareArrows, Handshake, ScrollText, Users, Settings,
} from 'lucide-react';
import { useAuth } from './auth';
import Shell from './components/Shell';
import { Spinner } from './components/ui';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Notifications from './pages/Notifications';

import StudentDashboard from './pages/student/Dashboard';
import ReportNew from './pages/student/ReportNew';
import MyReports from './pages/student/MyReports';
import ReportDetail from './pages/student/ReportDetail';
import CandidateDetail from './pages/student/CandidateDetail';
import MyClaims from './pages/student/MyClaims';
import ClaimDetail from './pages/student/ClaimDetail';
import Profile from './pages/student/Profile';

import AdminDashboard from './pages/admin/Dashboard';
import Intake from './pages/admin/Intake';
import Inventory from './pages/admin/Inventory';
import ItemDetail from './pages/admin/ItemDetail';
import LostReports from './pages/admin/LostReports';
import AdminReportDetail from './pages/admin/ReportDetail';
import Matches from './pages/admin/Matches';
import Claims from './pages/admin/Claims';
import ClaimReview from './pages/admin/ClaimReview';
import Handovers from './pages/admin/Handovers';
import AuditLog from './pages/admin/AuditLog';
import UsersPage from './pages/admin/Users';
import SettingsPage from './pages/admin/Settings';

const studentNav = [
  { to: '/student', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/student/report', label: 'Report Lost Item', icon: FilePlus2 },
  { to: '/student/reports', label: 'My Reports', icon: FileSearch },
  { to: '/student/claims', label: 'My Claims', icon: ShieldCheck },
  { to: '/student/notifications', label: 'Notifications', icon: Bell },
  { to: '/student/profile', label: 'Profile', icon: UserRound },
];

const adminNav = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/intake', label: 'Register Found Item', icon: PackagePlus },
  { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  { to: '/admin/lost-reports', label: 'Lost Reports', icon: FileSearch },
  { to: '/admin/matches', label: 'Matches', icon: GitCompareArrows },
  { to: '/admin/claims', label: 'Claims Review', icon: ListChecks },
  { to: '/admin/handovers', label: 'Handovers', icon: Handshake },
  { to: '/admin/audit', label: 'Audit Log', icon: ScrollText },
  { to: '/admin/users', label: 'Students', icon: Users },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
];

function RequireRole({ role, children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <Spinner />;
  if (!user) return <Navigate to={`/login?role=${role}`} replace state={{ from: loc.pathname }} />;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/student'} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Login register />} />

      <Route path="/student" element={<RequireRole role="student"><Shell nav={studentNav} base="/student" roleLabel="Student" /></RequireRole>}>
        <Route index element={<StudentDashboard />} />
        <Route path="report" element={<ReportNew />} />
        <Route path="reports" element={<MyReports />} />
        <Route path="reports/:id" element={<ReportDetail />} />
        <Route path="reports/:id/candidates/:itemId" element={<CandidateDetail />} />
        <Route path="claims" element={<MyClaims />} />
        <Route path="claims/:id" element={<ClaimDetail />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="profile" element={<Profile />} />
      </Route>

      <Route path="/admin" element={<RequireRole role="admin"><Shell nav={adminNav} base="/admin" roleLabel="Admin Desk" /></RequireRole>}>
        <Route index element={<AdminDashboard />} />
        <Route path="intake" element={<Intake />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="inventory/:id" element={<ItemDetail />} />
        <Route path="lost-reports" element={<LostReports />} />
        <Route path="lost-reports/:id" element={<AdminReportDetail />} />
        <Route path="matches" element={<Matches />} />
        <Route path="claims" element={<Claims />} />
        <Route path="claims/:id" element={<ClaimReview />} />
        <Route path="handovers" element={<Handovers />} />
        <Route path="audit" element={<AuditLog />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="notifications" element={<Notifications />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
