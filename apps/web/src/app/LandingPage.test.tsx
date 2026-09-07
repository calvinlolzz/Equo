// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LandingPage } from "./LandingPage";
import { LegalPage } from "./LegalPage";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";
import { readAppFile } from "./cssDeclarations";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.landing;

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("LandingPage", () => {
  test("keeps signing in as the first thing on the page", () => {
    const onGoogleLogin = vi.fn();
    render(<LandingPage onGoogleLogin={onGoogleLogin} />);

    const button = screen.getByRole("button", { name: new RegExp(UI_TEXT.login.googleLogin) });
    fireEvent.click(button);

    expect(onGoogleLogin).toHaveBeenCalledTimes(1);
  });

  test("surfaces the sign-in error the login card was given", () => {
    render(<LandingPage onGoogleLogin={() => {}} errorMessage="登入失敗：boom" />);
    expect(screen.getByText("登入失敗：boom")).toBeTruthy();
  });

  test("answers the questions a signed-out visitor has, in the page itself", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    // The whole point of the page: the answers are IN the markup, not behind a
    // click, so a crawler and a first-time reader see the same thing.
    expect(screen.getByText(text.faq1A)).toBeTruthy();
    expect(screen.getByText(text.faq5A)).toBeTruthy();
    expect(screen.getByText(text.value2Body)).toBeTruthy();
  });

  test("links the legal documents at their public URLs", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    // Not a dialog the visitor has to be signed in to open — the href is the
    // thing an OAuth review or an app directory is given.
    expect(screen.getByRole("link", { name: UI_TEXT.profile.privacyPolicy }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByRole("link", { name: UI_TEXT.profile.termsOfService }).getAttribute("href")).toBe("/terms");
  });
});

describe("LegalPage", () => {
  test("renders the policy itself, not a link to it", () => {
    render(<LegalPage page="privacy" />);

    expect(screen.getByRole("heading", { level: 1, name: PRIVACY_POLICY.title })).toBeTruthy();
    expect(screen.getByText(PRIVACY_POLICY.sections[0].heading)).toBeTruthy();
    expect(document.title).toContain(PRIVACY_POLICY.title);
  });

  test("the terms page serves the terms, and points at the other document", () => {
    render(<LegalPage page="terms" />);

    expect(screen.getByRole("heading", { level: 1, name: TERMS_OF_SERVICE.title })).toBeTruthy();
    expect(screen.getByRole("link", { name: UI_TEXT.profile.privacyPolicy }).getAttribute("href")).toBe("/privacy");
  });
});

describe("arriving from an invite link", () => {
  const preview = { group: { name: "東京旅行", member_count: 4 } };

  test("says which group the link points at, before anyone signs in", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-ABC123");
    const fetchInvitePreview = vi.fn().mockResolvedValue(preview);

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    expect(await screen.findByText("東京旅行")).toBeTruthy();
    expect(screen.getByText(text.inviteTitle)).toBeTruthy();
    expect(fetchInvitePreview).toHaveBeenCalledWith("EQO-ABC123");
    // Still a sign-in page: the card does not replace the wall, it explains it.
    expect(screen.getByRole("button", { name: new RegExp(UI_TEXT.login.googleLogin) })).toBeTruthy();
  });

  test("finds the token in the stash after the OAuth round-trip drops the query", async () => {
    // Supabase sends people back to the bare origin, so by then the URL has
    // nothing — only useInviteFlow's stash survives.
    window.sessionStorage.setItem("equo.clean.pending_invite", "EQO-STASHED");
    const fetchInvitePreview = vi.fn().mockResolvedValue(preview);

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    await waitFor(() => expect(fetchInvitePreview).toHaveBeenCalledWith("EQO-STASHED"));
  });

  test("a dead link is silent — the ordinary page, no error", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-DEAD");
    const fetchInvitePreview = vi.fn().mockRejectedValue(new Error("INVITE_EXPIRED"));

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    await waitFor(() => expect(fetchInvitePreview).toHaveBeenCalled());
    expect(screen.queryByText(text.inviteTitle)).toBeNull();
    expect(screen.getByText(text.faq1A)).toBeTruthy();
  });

  test("an ordinary visit asks nothing", () => {
    const fetchInvitePreview = vi.fn();

    render(<LandingPage onGoogleLogin={() => {}} fetchInvitePreview={fetchInvitePreview} />);

    // No token, no request: the landing page stays a page that needs no server.
    expect(fetchInvitePreview).not.toHaveBeenCalled();
    expect(screen.queryByText(text.inviteTitle)).toBeNull();
  });
});

/**
 * What a stranger can see before being asked for their Google account.
 *
 * This page used to spend its whole first screen — 772px of 812 — on an icon, a
 * name, a tagline and a sign-in button. The demo, the value props and the FAQ
 * were all below a scroll cue, and the real screenshots (public/screenshots)
 * were wired to the install prompt and nowhere else.
 */
describe("the product, above the fold", () => {
  const shot = () => document.querySelector<HTMLImageElement>(".landing-hero-shot img");

  test("the hero shows the app itself, not just its name", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);

    const image = shot();
    expect(image).toBeTruthy();
    expect(image?.getAttribute("src")).toContain("/screenshots/");
  });

  test("it is described, because it carries the argument the page is making", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    expect(shot()?.getAttribute("alt")).toBe(text.heroShotAlt);
  });

  test("and it is not queued behind everything else - it is the largest thing up there", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    const image = shot();

    expect(image?.getAttribute("loading")).not.toBe("lazy");
    // Intrinsic size on the tag, so the card below it does not jump when the
    // image lands.
    expect(image?.getAttribute("width")).toBeTruthy();
    expect(image?.getAttribute("height")).toBeTruthy();
  });

  test("but it stands aside for somebody who arrived from an invite", async () => {
    window.history.replaceState(null, "", "/?invite=EQO-ABC123");
    render(
      <LandingPage
        onGoogleLogin={() => {}}
        fetchInvitePreview={vi.fn().mockResolvedValue({ group: { name: "東京旅行", member_count: 4 } })}
      />,
    );

    // They have already decided; the invite card is the answer they came for,
    // and two cards plus a phone do not fit one screen.
    expect(await screen.findByText(text.inviteTitle)).toBeTruthy();
    expect(shot()).toBeNull();
  });
});

describe("the FAQ", () => {
  const items = () => [...document.querySelectorAll<HTMLDetailsElement>(".landing-faq-item")];

  test("answers its first question without being asked", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    const open = items().filter((item) => item.open);

    expect(items().length).toBeGreaterThan(1);
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toContain(text.faq1Q);
  });

  test("and leaves the rest closed, so the section is still skimmable", () => {
    render(<LandingPage onGoogleLogin={() => {}} />);
    expect(items().slice(1).every((item) => !item.open)).toBe(true);
  });
});

describe("the page's own metadata", () => {
  const html = readAppFile("..", "..", "index.html");

  test("says the page exists in English too", () => {
    // One document is served to everybody, so the card itself is the 繁體中文
    // one; this is the part that can be told without locale negotiation.
    expect(html).toContain('property="og:locale" content="zh_TW"');
    expect(html).toContain('property="og:locale:alternate" content="en_US"');
  });
});
