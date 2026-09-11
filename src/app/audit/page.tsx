import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { AuditPage } from "@/components/Audit/AuditPage";

export default async function Audit() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <AuditPage />;
}
