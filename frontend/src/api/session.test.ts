import { afterEach, describe, expect, it } from "vitest";
import { captureDemoKeyFromUrl, clearSession, getSession } from "./session";

describe("judge link: /demo#key=...", () => {
  afterEach(() => {
    clearSession();
    window.history.replaceState(null, "", "/");
  });

  it("stores the key for this tab only and removes it from the address bar", () => {
    window.history.replaceState(null, "", "/demo?x=1#key=abc%2B123");
    captureDemoKeyFromUrl();
    expect(getSession().demoKey).toBe("abc+123");
    expect(sessionStorage.getItem("outbreak-watch-session")).toContain("abc+123");
    expect(localStorage.length).toBe(0);
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/demo?x=1");
  });

  it("leaves the session and URL alone without a key", () => {
    window.history.replaceState(null, "", "/demo#other=1");
    const before = getSession().demoKey;
    captureDemoKeyFromUrl();
    expect(getSession().demoKey).toBe(before);
    expect(window.location.hash).toBe("#other=1");
  });
});
