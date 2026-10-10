import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, type ReactNode } from "react";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Shell } from "@/components/Shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LoadingBlock } from "@/components/States";
import { HomePage } from "@/pages/Home";
import { NotFound } from "@/pages/NotFound";
import { RouteError } from "@/pages/RouteError";

// Pages with heavy libraries load on demand: MapLibre (Map), Recharts (Alerts).
const MapPage = lazy(() => import("@/pages/MapPage").then((m) => ({ default: m.MapPage })));
const AlertsPage = lazy(() => import("@/pages/Alerts").then((m) => ({ default: m.AlertsPage })));
const ProofPage = lazy(() => import("@/pages/Proof").then((m) => ({ default: m.ProofPage })));
const ReportPage = lazy(() => import("@/pages/Report").then((m) => ({ default: m.ReportPage })));
const DataPage = lazy(() => import("@/pages/Data").then((m) => ({ default: m.DataPage })));
const page = (node: ReactNode) => <Suspense fallback={<LoadingBlock label="Loading page" />}>{node}</Suspense>;

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

const router = createBrowserRouter([
  {
    path: "/",
    element: <Shell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "demo", element: <HomePage /> },
      { path: "map", element: page(<MapPage />) },
      { path: "alerts", element: page(<AlertsPage />) },
      { path: "alerts/:id", element: page(<AlertsPage />) },
      { path: "proof", element: page(<ProofPage />) },
      { path: "data", element: page(<DataPage />) },
      { path: "report", element: page(<ReportPage />) },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
