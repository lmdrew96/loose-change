// Convex reads this file's default export directly; the named const is only
// here to satisfy import/no-anonymous-default-export.
const authConfig = {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
