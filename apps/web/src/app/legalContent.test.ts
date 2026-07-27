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

  test("the terms disclaim payment handling and name the governing law", () => {
    const text = allText(TERMS_OF_SERVICE);
    // Equo is a record-keeping tool, not a money mover — the disclaimer stores
    // and users both need to see.
    expect(text).toContain("不經手");
    expect(text).toContain("中華民國（台灣）");
  });
});
