import { PRIVACY_POLICY_EN, TERMS_OF_SERVICE_EN, TRANSLATION_NOTICE } from "./i18n/legalEn";
import { PRIVACY_POLICY_ZH, TERMS_OF_SERVICE_ZH } from "./i18n/legalZhHant";
import type { LegalDocument, LegalSection } from "./i18n/legalZhHant";
import { ACTIVE_LOCALE } from "./uiText";

// Re-exported so the documents and the address still arrive together for
// anything that wants both. Importers that want ONLY the address should take
// it from legalContact.ts - see the note there.
export { LEGAL_CONTACT_EMAIL } from "./legalContact";
export type { LegalDocument, LegalSection };

/**
 * The privacy policy and terms in the reader's language.
 *
 * ⚠️ The 繁體中文 documents are authoritative; the English ones are a
 * convenience translation and say so on their own first line, in English, where
 * an English reader will actually see it. Both files have to change together —
 * see the warning at the top of legalEn.ts.
 *
 * A banner rather than a footnote because the whole point is that somebody
 * relying on the English text should know, before reading it, which version
 * governs. Prepending it here rather than writing it into legalEn.ts keeps it
 * impossible to add an English document that forgets to carry it.
 */
function withTranslationNotice(document: LegalDocument): LegalDocument {
  return {
    ...document,
    intro: `${TRANSLATION_NOTICE}\n\n${document.intro}`,
  };
}

export const PRIVACY_POLICY: LegalDocument =
  ACTIVE_LOCALE === "en" ? withTranslationNotice(PRIVACY_POLICY_EN) : PRIVACY_POLICY_ZH;

export const TERMS_OF_SERVICE: LegalDocument =
  ACTIVE_LOCALE === "en" ? withTranslationNotice(TERMS_OF_SERVICE_EN) : TERMS_OF_SERVICE_ZH;
