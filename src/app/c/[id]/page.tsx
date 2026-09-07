import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ChatPage } from "@/components/Chat/ChatPage";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  const { id } = await params;
  // Keyed by id so navigating between two existing conversations (same route
  // pattern, different param) remounts ChatPage fresh instead of patching
  // props onto the previous instance — see the effect note in ChatPage.tsx.
  return <ChatPage key={id} initialConversationId={id} />;
}
