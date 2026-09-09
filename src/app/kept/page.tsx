import { Suspense } from "react";
import { KeptScreen } from "@/components/KeptScreen";

// KeptScreen reads ?entry= (the reminder deep-link) via useSearchParams, which
// on a prerendered route forces client-side rendering up to the nearest
// Suspense boundary. Providing one here keeps that contained.
export default function KeptPage() {
  return (
    <Suspense>
      <KeptScreen />
    </Suspense>
  );
}
