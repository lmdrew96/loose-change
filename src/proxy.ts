import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// MCP requests carry no Clerk session — they authenticate via a shared secret
// instead (see src/app/[token]/mcp/route.ts + convex/entries.ts mcp* functions).
//
// /offline must be public: the service worker precaches it, and registration
// happens on /sign-in too. Protected, cache.addAll would follow Clerk's
// redirect and store the sign-in page under the /offline key for the life of
// the cache.
const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/(.*)/mcp", "/offline"]);

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
