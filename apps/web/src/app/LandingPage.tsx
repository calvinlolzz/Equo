import { useEffect, useState } from "react";
import { ArrowRight, Calculator, Camera, ChevronDown, ChevronsDown, ReceiptText, UsersRound } from "lucide-react";
import { LoginScreen } from "./LoginScreen";
import { readPendingInviteToken } from "./useInviteFlow";
import { LEGAL_CONTACT_EMAIL } from "./legalContact";
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
  fetchInvitePreview,
}: {
  loading?: boolean;
  errorMessage?: string;
  onGoogleLogin: () => void;
  /**
   * Looks up what an invite link points at. Optional so the page still renders
   * standalone (and in tests) with no client wired up.
   */
  fetchInvitePreview?: (token: string) => Promise<{ group: { name: string; member_count: number } }>;
}) {
  // Captured during the first render, before useInviteFlow's effect strips the
  // query string — and falling back to the stash, which is all that survives
  // the OAuth round-trip.
  const [inviteToken] = useState(readPendingInviteToken);
  const [invite, setInvite] = useState<{ name: string; memberCount: number } | null>(null);

  useEffect(() => {
    if (!inviteToken || !fetchInvitePreview) return;
    let cancelled = false;

    fetchInvitePreview(inviteToken)
      .then((result) => {
        if (!cancelled) setInvite({ name: result.group.name, memberCount: result.group.member_count });
      })
      // A dead or unreachable link is not an error to show anybody: they get
      // the ordinary landing page, which is a complete answer on its own.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [inviteToken, fetchInvitePreview]);

  return (
    <div className="landing">
      <section className="landing-hero">
        {/* Someone arriving from a friend's link is the one visitor who already
            knows they want in — and used to be shown the same anonymous sign-in
            card as everybody else, with no sign that the link had worked. */}
        {invite ? (
          <div className="landing-invite glass-panel">
            <span className="landing-invite-label">{text.inviteTitle}</span>
            <strong className="landing-invite-group">{invite.name}</strong>
            <span className="landing-invite-meta">
              <UsersRound aria-hidden="true" size={14} />
              {invite.memberCount} {text.inviteMemberSuffix}
            </span>
            <span className="landing-invite-hint">{text.inviteHint}</span>
          </div>
        ) : (
          /* The product, above the fold.
             This screen used to ask a stranger for their Google account before
             showing them a single thing the account was for - the demo, the
             value props and the FAQ were all below a scroll cue. The real
             screenshots existed the whole time; they were only ever wired to
             the install prompt.
             Not shown to somebody arriving from an invite: they have already
             decided, and the invite card is the answer to the only question
             they came with. Two cards plus a phone would not fit either. */
          <div className="landing-hero-shot">
            <img
              src="/screenshots/hero-home.webp"
              // Two sources, because one was never enough for a phone: this is
              // shown at 232 CSS px on a 390px screen, which a 3x display draws
              // with 696 device pixels — so a 390px file was being upscaled
              // 1.78x, and the only product image on the page was soft on every
              // modern phone. x-descriptors rather than w/sizes: the displayed
              // width is decided by a breakpoint (232 on a phone, 390 on the
              // desktop two-column hero), not by a fluid container, so density
              // is the only thing left to choose on.
              srcSet="/screenshots/hero-home.webp 1x, /screenshots/hero-home@2x.webp 2x"
              width={390}
              height={416}
              alt={text.heroShotAlt}
              // The largest thing above the fold, so it is not lazy and not
              // queued behind the rest.
              fetchPriority="high"
              decoding="async"
            />
          </div>
        )}
        {/* The sign-in card, the one-line pitch and the scroll cue, as one
            block. On a phone this wrapper changes nothing — it stacks in the
            same order with the same gap. It exists for the desktop layout,
            where the hero becomes two columns and this is the right one: a
            flat list of four siblings could only spread those three items down
            the full height of the product shot beside them. */}
        <div className="landing-hero-panel">
          <LoginScreen loading={loading} errorMessage={errorMessage} onGoogleLogin={onGoogleLogin} brandIsHeading={false} />
          <p className="landing-pitch">{text.heroPitch}</p>
          {/* A scroll cue, not a control. The first version put a single
              chevron beside the label inside a bordered pill, which is the
              shape of a dropdown — people tapped it, the page jumped, and it
              read as "this expanded", with no way to collapse what had never
              opened. So: no pill, the double chevron BELOW the label (a shape
              no dropdown uses), and the jump is smoothed in CSS so the motion
              itself says scrolled rather than opened. */}
          <a className="landing-scroll-cue" href="#landing-value">
            <span>{text.scrollCue}</span>
            <ChevronsDown aria-hidden="true" size={18} />
          </a>
        </div>
      </section>

      {/* Everything below the hero sits on a scrim (see .landing-below). The
          backdrop is a bright animated field, and this is the only screen in
          the app that puts prose directly on it rather than inside a panel —
          without the scrim, a light blob drifting past takes a paragraph's
          contrast with it. */}
      <div className="landing-below">
        <section className="landing-section landing-demo" aria-label={text.demoLabel}>
          <div className="landing-demo-card glass-panel">
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
          {/* The page's h1. Not the brand in the sign-in card, which is what it
              used to be: "Equo" is the one thing about this page a stranger
              cannot already guess, and it was the whole heading. The section is
              below the fold and that is fine - a heading is judged on what it
              says, not on where it sits. */}
          <h1 className="landing-section-title">{text.valueTitle}</h1>
          <div className="landing-value-grid">
            {[
              { icon: <ReceiptText aria-hidden="true" size={20} />, title: text.value1Title, body: text.value1Body },
              { icon: <Calculator aria-hidden="true" size={20} />, title: text.value2Title, body: text.value2Body },
              { icon: <Camera aria-hidden="true" size={20} />, title: text.value3Title, body: text.value3Body },
            ].map((value) => (
              <article className="landing-value-card glass-panel" key={value.title}>
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
              <li className="landing-more-item glass-panel" key={item}>
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
            ].map((entry, index) => (
              /* The first one starts open. Five collapsed rows is five
                 questions and no answers, and 要付費嗎 is the answer most
                 likely to end the visit early in the right direction — a
                 disclosure that hides the reassurance is working against the
                 page it is on. The rest stay closed so the section is still
                 skimmable. */
              <details className="landing-faq-item glass-panel" key={entry.q} open={index === 0}>
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
