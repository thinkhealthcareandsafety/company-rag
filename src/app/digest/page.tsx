import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { DigestPage } from "@/components/Digest/DigestPage";

export default async function Digest() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <DigestPage />;
}
