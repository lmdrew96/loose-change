import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-jungle p-4">
      <SignUp appearance={{ variables: { colorPrimary: "#D19E2C" } }} />
    </main>
  );
}
