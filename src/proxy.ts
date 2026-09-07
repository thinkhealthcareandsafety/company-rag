import authMiddleware from "next-auth/middleware";

export default authMiddleware;

export const config = {
  matcher: ["/", "/c/:path*", "/documents/:path*", "/shortcuts/:path*"],
};
