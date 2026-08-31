// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LandingPage } from "./LandingPage";
import { LegalPage } from "./LegalPage";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.landing;

afterEach(cleanup);

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
