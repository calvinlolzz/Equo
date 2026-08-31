import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { LegalDocumentBody } from "./LegalDocumentBody";
import { LEGAL_CONTACT_EMAIL, PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";
import type { PublicPage } from "./publicRoute";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.landing;
const profileText = UI_TEXT.profile;

/**
 * /privacy and /terms as pages of their own.
 *
 * No session, no API call, no store: this renders from constants alone, so it
 * works for a signed-out visitor, for a crawler, and for whoever is reviewing
 * the OAuth consent screen. That is the whole point of it existing separately
 * from the in-app sheet.
 */
export function LegalPage({ page }: { page: PublicPage }) {
  const document = page === "privacy" ? PRIVACY_POLICY : TERMS_OF_SERVICE;
  const otherHref = page === "privacy" ? "/terms" : "/privacy";
  const otherLabel = page === "privacy" ? profileText.termsOfService : profileText.privacyPolicy;

  // The tab and the history entry should say which document this is. Set here
  // rather than in main.tsx so the title comes from the same lazy chunk as the
  // document itself — main.tsx would have to import the whole policy to know it.
  useEffect(() => {
    window.document.title = `${document.title} — Equo`;
  }, [document.title]);

  return (
    <main className="app-shell legal-page">
      <div className="legal-page-inner glass-panel">
        <a className="legal-page-back" href="/">
          <ArrowLeft aria-hidden="true" size={16} />
          {text.backToHome}
        </a>
        <header className="legal-page-header">
          <h1>{document.title}</h1>
          <p className="legal-updated">{document.updated}</p>
        </header>
        <div className="legal-page-body">
          <LegalDocumentBody document={document} />
        </div>
        <footer className="legal-page-footer">
          <a href={otherHref}>{otherLabel}</a>
          <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
        </footer>
      </div>
    </main>
  );
}
