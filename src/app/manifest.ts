import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "think health",
    short_name: "think health",
    description: "AI assistant for think health — documents, live CRM, Books, and Inventory data in one place",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: "#d94fa8",
    icons: [
      { src: "/logo.jpg", sizes: "192x192", type: "image/jpeg" },
      { src: "/logo.jpg", sizes: "512x512", type: "image/jpeg" },
    ],
  };
}
