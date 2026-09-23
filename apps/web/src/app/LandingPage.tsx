import { useEffect, useState } from "react";
import { ArrowRight, Calculator, Camera, ChevronDown, ReceiptText, UsersRound } from "lucide-react";
import { readPendingInviteToken } from "./useInviteFlow";
import { LEGAL_CONTACT_EMAIL } from "./legalContact";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.landing;
const profileText = UI_TEXT.profile;
const loginText = UI_TEXT.login;
const appText = UI_TEXT.app;
const ledgerText = UI_TEXT.personalLedger;

/**
 * The one icon this page draws itself, so the hero's CTA and the closing
 * band's CTA do not each need their own copy of it. Lifted verbatim from the
 * standalone login screen — same paths, same colours, same 20×20 box.
 */
function GoogleGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

/**
 * The first letter/character of a name, for a chat avatar.
 *
 * Deliberately the FIRST character rather than a fixed nickname: it is the
 * only rule that means the same thing in 小明 and in "Ming". Purely
 * decorative — every avatar it feeds is `aria-hidden`.
 */
function initial(name: string): string {
  return [...name][0] ?? "";
}

/**
 * What a signed-out visitor sees at "/".
 *
 * The hero used to be a card with a logo, a six-word tagline and a Google
 * button — a lot to ask of somebody who has never heard of Equo. It now leads
 * with the argument instead, but the first screen only carries the eyebrow,
 * the headline, a one-line lede and the button: the fabricated group chat
 * that dramatises the problem this app exists to solve (clearly labelled as
 * an illustration, not a testimonial), the three value cards and the real
 * product screenshot all sit below the fold, reached on a wide-enough screen
 * by a single cue at the bottom of the hero (see .landing-scroll-cue — a
 * phone gets no cue, because the hero already fills its screen), because
 * none of them earns top billing over a headline nobody has read yet.
 *
 * Three things this keeps from before:
 * - somebody arriving from a friend's invite link sees the invite card in
 *   the hero, above the button, in place of nothing — they have already
 *   decided, and the invite card is the answer to the only question they
 *   came with;
 * - everything below the hero answers "what is this and why would I hand
 *   over my Google account", ending at the FAQ where the awkward questions
 *   (cost, data, no-account friends) get answered plainly;
 * - it is static markup with no session, no API call and no store, so it
 *   renders for a crawler and a first-time visitor identically.
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

  const cta = loading ? (
    <div className="landing-cta-loading" role="status" aria-live="polite">
      <span className="pulse-dot active" />
      <span>{loginText.loggingIn}</span>
    </div>
  ) : (
    <button className="landing-cta" type="button" onClick={onGoogleLogin}>
      <GoogleGlyph />
      {loginText.googleLogin}
    </button>
  );

  return (
    <div className="landing">
      <header className="landing-topbar">
        <span className="landing-topbar-brand">
          <img src="/icons/equo-icon.svg" width={30} height={30} alt="" aria-hidden="true" />
          Equo
        </span>
      </header>

      <section className="landing-hero">
        {/* Someone arriving from a friend's link is the one visitor who already
            knows they want in — and used to be shown the same anonymous sign-in
            card as everybody else, with no sign that the link had worked. This
            card answers that, above the button; the fabricated chat below the
            fold does not render for them either (see .landing-below) — they do
            not need the argument for why Equo exists, only the confirmation
            that this link works. */}
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
        ) : null}

        <div className="landing-hero-copy">
          <span className="landing-eyebrow">{text.heroPitch}</span>
          {/* The page's h1. Not the brand — "Equo" is a word nobody arriving
              here has heard yet, and it used to be the whole heading. This is
              the one thing about the page a stranger cannot already guess. */}
          <h1 className="landing-hero-title">{text.valueTitle}</h1>
          <p className="landing-hero-lede">{text.heroLede}</p>
          {errorMessage ? <p className="landing-cta-error">{errorMessage}</p> : null}
          {cta}
        </div>

        {/* The only "there is more" signal left once the topbar's two links
            are gone. A real anchor, not a button that scrolls: it is read out
            of this file's own source by publicPageSeo.test.ts, which requires
            a matching id somewhere in the same document. Hidden on a phone
            (see .landing-scroll-cue) — the first screen there is the eyebrow,
            the headline, the lede and the button, nothing else, and the hero
            itself fills the screen (see .landing-hero's min-height), so a
            cue would just be inviting a tap on something not yet visible. */}
        <a className="landing-scroll-cue" href="#landing-value">
          {text.scrollCue}
          <ChevronDown aria-hidden="true" size={16} />
        </a>
      </section>

      {/* Everything below the hero sits on a scrim (see .landing-below). The
          backdrop is a bright animated field, and this is the only screen in
          the app that puts prose directly on it rather than inside a panel —
          without the scrim, a light blob drifting past takes a paragraph's
          contrast with it. */}
      <div className="landing-below">
        {invite ? null : (
          /* The argument, no longer above the fold: a fabricated group chat
             where two people cannot agree who owes whom, resolved by Equo's
             own suggestion. demoChatLabel is not decoration — without it
             these four invented lines would read as a real customer's words.
             Wrapped in .landing-section rather than left bare: that class is
             what gives every block here its width and gutter, and this one
             has no heading of its own to hang that on. */
          <div className="landing-section landing-chat-band">
            <figure className="landing-chat glass-panel">
              <figcaption className="landing-chat-label">{text.demoChatLabel}</figcaption>

              <div className="landing-chat-row">
                <span className="landing-chat-avatar landing-chat-avatar--gold" aria-hidden="true">
                  {initial(text.demoSettleTo1)}
                </span>
                <span className="landing-chat-bubble">{text.chatLine1}</span>
              </div>

              <div className="landing-chat-row">
                <span className="landing-chat-avatar landing-chat-avatar--mint" aria-hidden="true">
                  {initial(text.demoSettleFrom2)}
                </span>
                <span className="landing-chat-bubble">{text.chatLine2}</span>
              </div>

              <div className="landing-chat-row landing-chat-row--self">
                <span className="landing-chat-bubble landing-chat-bubble--self">{text.chatLine3}</span>
              </div>

              <div className="landing-settle">
                <div className="landing-settle-head">
                  <img src="/icons/equo-icon.svg" width={20} height={20} alt="" aria-hidden="true" />
                  <strong>{text.demoSettleTitle}</strong>
                </div>
                <div className="landing-settle-row">
                  <span className="landing-settle-names">
                    {text.demoSettleFrom1}
                    <ArrowRight aria-hidden="true" size={14} />
                    {text.demoSettleTo1}
                  </span>
                  <strong className="landing-settle-amount">{text.demoSettleAmount1}</strong>
                </div>
                <div className="landing-settle-row">
                  <span className="landing-settle-names">
                    {text.demoSettleFrom2}
                    <ArrowRight aria-hidden="true" size={14} />
                    {text.demoSettleTo2}
                  </span>
                  <strong className="landing-settle-amount">{text.demoSettleAmount2}</strong>
                </div>
                <p className="landing-settle-note">{text.chatSettleNote}</p>
              </div>

              <div className="landing-chat-row landing-chat-row--self">
                <span className="landing-chat-bubble landing-chat-bubble--self">{text.chatLine4}</span>
              </div>
            </figure>
          </div>
        )}

        <section className="landing-section" id="landing-value">
          <h2 className="landing-section-title">{text.scrollCue}</h2>
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

          {/* The real product, once there is a claim on screen for it to back
              up. Below the fold now, so it is lazy rather than the largest
              thing queued on load — the headline is. */}
          <figure className="landing-shot">
            <img
              src="/screenshots/hero-home.webp"
              // Two sources, because one was never enough for a phone: this is
              // shown at 232 CSS px on a 390px screen, which a 3x display draws
              // with 696 device pixels — so a 390px file was being upscaled
              // 1.78x, and the only product image on the page was soft on every
              // modern phone. x-descriptors rather than w/sizes: the displayed
              // width is decided by a breakpoint (232 on a phone, 390 on a
              // wider screen), not by a fluid container, so density is the
              // only thing left to choose on.
              srcSet="/screenshots/hero-home.webp 1x, /screenshots/hero-home@2x.webp 2x"
              width={390}
              height={416}
              alt={text.heroShotAlt}
              loading="lazy"
              decoding="async"
            />
          </figure>
        </section>

        {/* The personal ledger on its own. No <button> in here - the page
            pins exactly two. */}
        <section className="landing-section" id="landing-ledger">
          <h2 className="landing-section-title">{text.ledgerTitle}</h2>
          <p className="landing-ledger-body">{text.ledgerBody}</p>
          <figure className="landing-ledger glass-panel">
            <figcaption className="landing-chat-label">{text.demoLedgerLabel}</figcaption>
            <span>{ledgerText.monthExpense}</span>
            <strong className="landing-ledger-total">{text.demoLedgerExpense}</strong>
            <p className="landing-ledger-stats">{`${ledgerText.monthIncome} ${text.demoLedgerIncome} · ${ledgerText.monthNet} ${text.demoLedgerNet}`}</p>
            <div className="landing-ledger-row">
              <span>{text.demoLedgerBudgetLabel}</span>
              <strong>{text.demoLedgerBudgetLeft}</strong>
            </div>
          </figure>
        </section>

        <section className="landing-section">
          <h2 className="landing-section-title">{text.moreTitle}</h2>
          <ul className="landing-more-list">
            {[text.more1, text.more2, text.more3].map((item) => (
              <li className="landing-more-item glass-panel" key={item}>
                {item}
              </li>
            ))}
          </ul>
          {/* Three more, collapsed rather than gone: <details> keeps them in
              the markup for a crawler or a no-JS reader, it just does not
              spend first-screen space on them. viewAll is the app's own
              "see the rest" label (see GroupHome's member rows) — reused
              rather than inventing a landing-only word for the same idea. */}
          <details className="landing-more-rest">
            <summary>
              {appText.viewAll}
              <ChevronDown aria-hidden="true" size={16} />
            </summary>
            <ul className="landing-more-list">
              {[text.more4, text.more5, text.more6].map((item) => (
                <li className="landing-more-item glass-panel" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section className="landing-section" id="landing-faq">
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
              <details className="landing-faq-item glass-panel" key={entry.q}>
                <summary>
                  {entry.q}
                  <ChevronDown aria-hidden="true" size={16} />
                </summary>
                <p>{entry.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-closing">
            <h2 className="landing-closing-title">{text.closingTitle}</h2>
            <p className="landing-closing-line">{loginText.tagline}</p>
            {/* A second sign-in button needs its own label — "使用 Google
                登入" already appears once in the hero, and Testing Library's
                getByText/getByRole throw on finding the same accessible name
                twice. closingCta names Google without repeating the string.
                Disabled while a login is already in flight: the hero swaps
                to a loading row when that happens, and without this a click
                down here fires a second sign-in on top of the first one. */}
            <button
              className="landing-cta landing-cta--closing"
              type="button"
              disabled={loading}
              onClick={onGoogleLogin}
            >
              <GoogleGlyph />
              {text.closingCta}
            </button>
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
