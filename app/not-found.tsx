import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navy top band */}
      <div className="bg-[hsl(222,35%,8%)] flex flex-col items-center justify-center py-24 px-6 flex-shrink-0">
        <p className="text-[120px] font-bold leading-none text-white/10 select-none">404</p>
        <p className="text-xl font-semibold text-white -mt-6">Page not found</p>
      </div>
      {/* Cream bottom */}
      <div className="flex-1 bg-[hsl(38,30%,97%)] flex flex-col items-center justify-center p-10 text-center">
        <p className="text-muted-foreground max-w-sm">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}
