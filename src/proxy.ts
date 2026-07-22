import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// MCP requests carry no Clerk session — they authenticate via a shared secret
// instead (see src/app/[token]/mcp/route.ts + convex/entries.ts mcp* functions).
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/(.*)/mcp"]);

const proxy = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default proxy;

export const config = {
  matcher: [
    "/((?!_next|.*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
