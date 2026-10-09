import { Home } from "lucide-react";
import { Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";
import { SoftCard } from "@/components/SoftCard";

export function NotFound() {
  return (
    <SoftCard size="lg" className="flex max-w-xl flex-col items-start gap-4 p-8">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <p className="text-muted">This address does not match any page in Outbreak Watch.</p>
      <Link to="/" className={buttonVariants({ variant: "primary" })}><Home aria-hidden="true" />Go to Home</Link>
    </SoftCard>
  );
}
