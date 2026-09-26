import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/700.css";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
// DESIGN.md's display face is Copernicus/Tiempos Headline; its own
// substitution note names Cormorant Garamond as the closest open-source
// approximation, at weight 500 with negative tracking.
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "./index.css";
import App from "./App";
import { migrateLegacyData } from "./lib/localDb";

migrateLegacyData();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
