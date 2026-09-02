// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LandingPage } from "./LandingPage";
import { LegalPage } from "./LegalPage";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";
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
