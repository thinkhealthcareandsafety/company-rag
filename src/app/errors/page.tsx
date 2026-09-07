import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ErrorsPage } from "@/components/Errors/ErrorsPage";

export default async function Errors() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <ErrorsPage />;
}
