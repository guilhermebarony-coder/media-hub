import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./shell/Shell";
import DownloadPage from "./pages/Download";
import LibraryPage from "./pages/Library";
import ProjectsPage from "./pages/Projects";
import SettingsPage from "./pages/Settings";
import { ActiveProjectProvider } from "./lib/activeProject";
import "./App.css";

/**
 * Router. HashRouter (not BrowserRouter) because Tauri serves the app
 * over `tauri://` in production and `http://localhost` in dev, and
 * we don't want to deal with serving routes from different origins.
 * Hash routes work the same in both environments.
 *
 * Default route is /library — the post-onboarding workflow is "open
 * app → see what you have → click Download when you need more."
 */
export default function App() {
  return (
    <ActiveProjectProvider>
      <HashRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<Navigate to="/library" replace />} />
            <Route path="/download" element={<DownloadPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/library" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ActiveProjectProvider>
  );
}
