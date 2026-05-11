import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar } from "./_components/sidebar";
import { ChatPanel } from "./_components/chat-panel";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    include: { organisation: true },
  });

  if (!user?.organisation?.onboardingComplete) {
    redirect("/onboarding");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside className="hidden md:flex md:shrink-0 shadow-[1px_0_0_0_hsl(220_16%_88%)]">
        <Sidebar orgName={user.organisation.name} />
      </aside>
      <main className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
      <ChatPanel />
    </div>
  );
}
