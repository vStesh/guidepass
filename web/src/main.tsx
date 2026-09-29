import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { createAuth } from "./auth.ts";
import { loadConfig } from "./config.ts";
import "./styles.css";

const config = await loadConfig();
const auth = await createAuth(config);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App auth={auth} />
  </StrictMode>,
);
