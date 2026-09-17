import { Suspense } from "react";
import { SearchScreen } from "@/components/SearchScreen";

// SearchScreen keeps its query and filter in the URL via useSearchParams,
// which needs a Suspense boundary on a prerendered route — same as /kept.
export default function SearchPage() {
  return (
    <Suspense>
      <SearchScreen />
    </Suspense>
  );
}
