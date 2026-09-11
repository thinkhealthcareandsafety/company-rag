import { TopNav } from "@/components/TopNav";
import { PageLoader } from "@/components/Loader";

export default function Loading() {
  return (
    <>
      <TopNav />
      <main style={{ maxWidth: 800, width: "100%", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <PageLoader />
      </main>
    </>
  );
}
