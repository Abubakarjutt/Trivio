import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { AppShell } from "./_components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organisation: true },
  });

  if (!user) {
    // User exists in session (JWT) but not in DB — stale token or account deleted.
    // Redirect to login so they can authenticate with a valid account.
    redirect("/login");
  }

  if (!user.organisation?.onboardingComplete) {
    redirect("/onboarding");
  }

  return <AppShell orgName={user.organisation.name}>{children}</AppShell>;
}
