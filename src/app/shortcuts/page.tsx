import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ShortcutsPage } from "@/components/Shortcuts/ShortcutsPage";

export default async function Shortcuts() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <ShortcutsPage />;
}
