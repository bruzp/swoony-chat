import "@/lib/zodConfig";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/app.css";
import { AdminApp } from "./AdminApp";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
