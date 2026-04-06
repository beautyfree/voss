import { BrowserRouter, Routes, Route } from "react-router-dom";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Projects } from "./pages/Projects";
import { ProjectDetail } from "./pages/ProjectDetail";
import { Server } from "./pages/Server";
import { Login } from "./pages/Login";
import { Landing } from "./pages/Landing";
import { ToastContainer } from "./components/Toast";
import "./styles.css";

function App() {
  const [authed, setAuthed] = useState(() => !!localStorage.getItem("voss_api_key"));
  const [showLogin, setShowLogin] = useState(false);

  if (!authed) {
    if (showLogin) {
      return <Login onLogin={() => setAuthed(true)} />;
    }
    return <Landing onLogin={() => setShowLogin(true)} />;
  }

  return (
    <BrowserRouter>
      <div className="layout">
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<Projects />} />
            <Route path="/projects/:name" element={<ProjectDetail />} />
            <Route path="/server" element={<Server />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
