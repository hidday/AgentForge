import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardPage } from "@/pages/DashboardPage.tsx";
import { RunDetailPage } from "@/pages/RunDetailPage.tsx";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/runs/:id" element={<RunDetailPage />} />
      </Routes>
    </BrowserRouter>
  );
}
