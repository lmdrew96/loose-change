import { describe, expect, test } from "vitest";
import { buildSharedTranscript } from "./share";

describe("buildSharedTranscript", () => {
  test("combines title, text and url, in that order", () => {
    expect(buildSharedTranscript({ title: "A post", text: "worth reading", url: "https://x.test/p" })).toBe(
      "A post\n\nworth reading\n\nhttps://x.test/p",
    );
  });

  test("doesn't repeat a url the text already contains", () => {
    expect(buildSharedTranscript({ text: "look https://x.test/p", url: "https://x.test/p" })).toBe(
      "look https://x.test/p",
    );
  });

  test("doesn't repeat a title that's already in the text or is the url", () => {
    expect(buildSharedTranscript({ title: "A post", text: "A post — by someone" })).toBe("A post — by someone");
    expect(buildSharedTranscript({ title: "https://x.test/p", url: "https://x.test/p" })).toBe("https://x.test/p");
  });

  test("a url on its own is enough", () => {
    expect(buildSharedTranscript({ url: " https://x.test/p " })).toBe("https://x.test/p");
  });

  test("nothing usable is null, not an empty capture", () => {
    expect(buildSharedTranscript({})).toBeNull();
    expect(buildSharedTranscript({ title: "  ", text: "", url: null })).toBeNull();
  });
});
