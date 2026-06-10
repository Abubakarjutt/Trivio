import { auth } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";

export default async function CatchAllNotFoundPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  notFound();
}
