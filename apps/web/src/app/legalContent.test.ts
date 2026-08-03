import { describe, expect, test } from "vitest";
import { LEGAL_CONTACT_EMAIL, PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";

function allText(doc: typeof PRIVACY_POLICY): string {
  return [
    doc.title,
    doc.intro,
    ...doc.sections.flatMap((s) => [
      s.heading,
      ...(s.paragraphs ?? []),
      ...(s.bullets ?? []),
      ...(s.callout ? [s.callout.tag, ...s.callout.paragraphs] : []),
    ]),
  ].join("\n");
}

describe("legal content", () => {
  test("neither document is still the launch-blocking placeholder", () => {
    // The store review and OAuth verification both reject "coming soon" policy
    // text — this is the guard that the real content shipped.
    for (const doc of [PRIVACY_POLICY, TERMS_OF_SERVICE]) {
      expect(allText(doc)).not.toContain("準備中");
      expect(doc.sections.length).toBeGreaterThanOrEqual(6);
    }
  });

  test("both documents give a working contact address", () => {
    expect(LEGAL_CONTACT_EMAIL).toBe("support@equomu.com");
    expect(allText(PRIVACY_POLICY)).toContain(LEGAL_CONTACT_EMAIL);
    expect(allText(TERMS_OF_SERVICE)).toContain(LEGAL_CONTACT_EMAIL);
  });

  test("the privacy policy states what account deletion actually does", () => {
    // Must match the real behaviour of delete_my_account: erase the identity,
    // anonymise shared-group entries to 已刪除的使用者.
    const text = allText(PRIVACY_POLICY);
    expect(text).toContain("刪除");
    expect(text).toContain("已刪除的使用者");
  });

  test("section numbers run in sequence in both documents", () => {
    // Inserting a section means renumbering everything after it, and a skipped
    // or repeated number in a policy that cross-references "見第 3 節" is the
    // kind of slip nobody notices until a reviewer does.
    for (const doc of [PRIVACY_POLICY, TERMS_OF_SERVICE]) {
      const numbers = doc.sections.map((section) => Number(section.heading.split(".")[0]));
      expect(numbers).toEqual(numbers.map((_, index) => index + 1));
    }
  });

  test("the privacy policy discloses that receipt scans leave for a third-party AI", () => {
    const text = allText(PRIVACY_POLICY);
    // Naming the provider is the point: under its free tier the content is used
    // to improve their products and may be read by their staff, which is a
    // materially different promise from an ordinary sub-processor.
    expect(text).toContain("Gemini");
    expect(text).toContain("改善");
    expect(text).toContain("閱讀");
  });

  test("the privacy policy tells users how to avoid the AI entirely", () => {
    // A disclosure with no way out is a warning, not a choice - and there IS a
    // way out here, because the composer's own photo picker never scans.
    expect(allText(PRIVACY_POLICY)).toContain("不會送去辨識");
  });

  test("the terms' content licence covers sending photos to that third party", () => {
    // Storing and displaying was all the old clause permitted; scanning sends
    // the photo somewhere else entirely.
    expect(allText(TERMS_OF_SERVICE)).toContain("第三方 AI");
  });

  test("the terms disclaim payment handling and name the governing law", () => {
    const text = allText(TERMS_OF_SERVICE);
    // Equo is a record-keeping tool, not a money mover — the disclaimer stores
    // and users both need to see.
    expect(text).toContain("不經手");
    expect(text).toContain("中華民國（台灣）");
  });
});
