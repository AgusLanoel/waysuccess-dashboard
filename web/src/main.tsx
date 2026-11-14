import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./rediseno.css";
import App from "./App";

// 14-11: el dashboard es siempre oscuro (los colores por pestaña están pensados para fondo oscuro)
document.documentElement.dataset.theme = "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
