import { ArrowRight, Calculator, Camera, ChevronDown, ChevronsDown, ReceiptText } from "lucide-react";
import { LoginScreen } from "./LoginScreen";
import { LEGAL_CONTACT_EMAIL } from "./legalContent";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.landing;
const profileText = UI_TEXT.profile;

/**
 * What a signed-out visitor sees at "/".
 *
 * Until this existed, the entire public face of Equo was a card with a logo, a
 * six-word tagline and a Google button — which is a lot to ask of somebody who
 * arrived from a friend's invite link and has never heard of it. Three things
 * follow from that and shape this page:
 *
 * - the sign-in card stays exactly where it was, first thing on the screen, so
 *   returning visitors lose nothing and nobody has to scroll to sign in;
 * - everything below it answers "what is this and why would I hand over my
 *   Google account", in that order, ending at the FAQ where the awkward
 *   questions (cost, data, no-account friends) get answered plainly;
 * - it is static markup with no session, no API call and no store, so it
 *   renders for a crawler and for a first-time visitor identically.
 *
 * The product illustration is drawn in markup rather than screenshotted on
 * purpose: a screenshot of somebody's real group is somebody's real data, and a
 * screenshot of a fake one goes stale the first time the UI moves.
 */
export function LandingPage({
  loading,
  errorMessage,
  onGoogleLogin,
}: {
  loading?: boolean;
  errorMessage?: string;
  onGoogleLogin: () => void;
}) {
  return (
    <div className="landing">
      <section className="landing-hero">
        <LoginScreen loading={loading} errorMessage={errorMessage} onGoogleLogin={onGoogleLogin} />
        <p className="landing-pitch">{text.heroPitch}</p>
        {/* A scroll cue, not a control. The first version put a single chevron
            beside the label inside a bordered pill, which is the shape of a
            dropdown — people tapped it, the page jumped, and it read as "this
            expanded", with no way to collapse what had never opened. So: no
            pill, the double chevron BELOW the label (a shape no dropdown uses),
            and the jump is smoothed in CSS so the motion itself says scrolled
            rather than opened. */}
        <a className="landing-scroll-cue" href="#landing-value">
          <span>{text.scrollCue}</span>
          <ChevronsDown aria-hidden="true" size={18} />
        </a>
      </section>

      {/* Everything below the hero sits on a scrim (see .landing-below). The
          backdrop is a bright animated field, and this is the only screen in
          the app that puts prose directly on it rather than inside a panel —
          without the scrim, a light blob drifting past takes a paragraph's
          contrast with it. */}
      <div className="landing-below">
        <section className="landing-section landing-demo" aria-label={text.demoLabel}>
          <div className="landing-demo-card">
            <span className="landing-demo-label">{text.demoLabel}</span>

            <div className="landing-demo-expense">
              <span className="landing-demo-avatar" aria-hidden="true">
                <ReceiptText size={18} />
              </span>
              <div className="landing-demo-expense-text">
                <strong>{text.demoExpenseTitle}</strong>
                <span>{text.demoExpenseMeta}</span>
              </div>
              <span className="landing-demo-amount">{text.demoExpenseAmount}</span>
            </div>

            <div className="landing-demo-settle">
              <span className="landing-demo-settle-title">{text.demoSettleTitle}</span>
              <ul>
                <li>
                  <span className="landing-demo-names">
                    {text.demoSettleFrom1}
                    <ArrowRight aria-hidden="true" size={14} />
                    {text.demoSettleTo1}
                  </span>
                  <span className="landing-demo-transfer">{text.demoSettleAmount1}</span>
                </li>
                <li>
                  <span className="landing-demo-names">
                    {text.demoSettleFrom2}
                    <ArrowRight aria-hidden="true" size={14} />
                    {text.demoSettleTo2}
                  </span>
                  <span className="landing-demo-transfer">{text.demoSettleAmount2}</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="landing-section" id="landing-value">
          <h2 className="landing-section-title">{text.valueTitle}</h2>
          <div className="landing-value-grid">
            {[
              { icon: <ReceiptText aria-hidden="true" size={20} />, title: text.value1Title, body: text.value1Body },
              { icon: <Calculator aria-hidden="true" size={20} />, title: text.value2Title, body: text.value2Body },
              { icon: <Camera aria-hidden="true" size={20} />, title: text.value3Title, body: text.value3Body },
            ].map((value) => (
              <article className="landing-value-card" key={value.title}>
                <span className="landing-value-icon">{value.icon}</span>
                <h3>{value.title}</h3>
                <p>{value.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <h2 className="landing-section-title">{text.moreTitle}</h2>
          <ul className="landing-more-list">
            {[text.more1, text.more2, text.more3, text.more4, text.more5, text.more6].map((item) => (
              <li className="landing-more-item" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="landing-section">
          <h2 className="landing-section-title">{text.faqTitle}</h2>
          {/* Native <details>: open/close with no JavaScript, reachable by
              keyboard and announced as a disclosure, and it survives the page
              being read with the entry chunk still loading. */}
          <div className="landing-faq">
            {[
              { q: text.faq1Q, a: text.faq1A },
              { q: text.faq2Q, a: text.faq2A },
              { q: text.faq3Q, a: text.faq3A },
              { q: text.faq4Q, a: text.faq4A },
              { q: text.faq5Q, a: text.faq5A },
            ].map((entry) => (
              <details className="landing-faq-item" key={entry.q}>
                <summary>
                  {entry.q}
                  <ChevronDown aria-hidden="true" size={16} />
                </summary>
                <p>{entry.a}</p>
              </details>
            ))}
          </div>
        </section>

        <footer className="landing-footer">
          <p className="landing-footer-tagline">{text.footerTagline}</p>
          <nav className="landing-footer-links">
            <a href="/privacy">{profileText.privacyPolicy}</a>
            <a href="/terms">{profileText.termsOfService}</a>
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{text.footerContact}</a>
          </nav>
        </footer>
      </div>
    </div>
  );
}
