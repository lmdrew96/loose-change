import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-jungle p-4">
      <SignIn appearance={{ variables: { colorPrimary: "#D19E2C" } }} />
    </main>
  );
}
