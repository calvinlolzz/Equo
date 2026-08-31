import type { LegalDocument } from "./legalContent";

/**
 * The rendered body of a legal document, shared by the two places it appears:
 * the sheet inside the profile dialog and the standalone /privacy and /terms
 * pages.
 *
 * One component rather than two copies of the same markup because the documents
 * are the same documents — a bullet list that renders inside the app and goes
 * missing on the public page would be exactly the kind of discrepancy these
 * pages exist to avoid.
 */
export function LegalDocumentBody({ document }: { document: LegalDocument }) {
  return (
    <>
      <p className="legal-intro">{document.intro}</p>
      {document.sections.map((section) => (
        <section className="legal-section" key={section.heading}>
          <h4>{section.heading}</h4>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph}>{paragraph}</p>
          ))}
          {section.bullets ? (
            <ul>
              {section.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          ) : null}
          {section.callout ? (
            <div className="legal-callout">
              <span className="legal-callout-tag">{section.callout.tag}</span>
              {section.callout.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </>
  );
}
