import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";

export default function Loading() {
  return (
    <div className="chat-page-root">
      <TopNav />
      <div className="chat-shell">
        <PageLoader label="Loading conversation…" />
      </div>
    </div>
  );
}
