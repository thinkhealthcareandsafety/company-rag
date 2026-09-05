import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DocumentsPage } from "@/components/Documents/DocumentsPage";

export default async function Documents() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <DocumentsPage />;
}
