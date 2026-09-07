import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { TeamPage } from "@/components/Team/TeamPage";

export default async function Team() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <TeamPage />;
}
