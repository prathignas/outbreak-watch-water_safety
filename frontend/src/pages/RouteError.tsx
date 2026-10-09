import { RefreshCw } from "lucide-react";
import { useRouteError } from "react-router";
import { Button } from "@/components/ui/button";

export function RouteError() {
  const error = useRouteError();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8" role="alert">
      <h1 className="text-3xl font-bold">This page could not be shown</h1>
      <p className="text-muted">{error instanceof Error ? error.message : "An unexpected error happened."}</p>
      <Button variant="primary" className="self-start" onClick={() => location.reload()}><RefreshCw aria-hidden="true" />Reload the page</Button>
    </main>
  );
}
