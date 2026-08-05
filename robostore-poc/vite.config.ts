import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Standalone dev server, deliberately on a different port than
// cloud-container/frontend (3000) so both can run side by side during the
// POC phase. See README.md for why this is a separate app entirely.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    host: true,
  },
  preview: {
    port: 3100,
  },
});
