import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ChatPage } from "@/components/Chat/ChatPage";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <ChatPage />;
}
