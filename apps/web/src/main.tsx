import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { makeQueryClient } from "./lib/queryClient";
import { TermProvider } from "./lib/state";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={makeQueryClient()}>
      <BrowserRouter>
        <ErrorBoundary>
          <TermProvider>
            <App />
          </TermProvider>
        </ErrorBoundary>
      </BrowserRouter>
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
