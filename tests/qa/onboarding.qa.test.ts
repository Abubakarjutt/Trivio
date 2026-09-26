// QA: sign-up and onboarding, exactly as a new desktop user goes through it.
import { describe, it, expect } from "vitest";
import { callerFor, db, newUser } from "./harness";

describe("sign-up & onboarding", () => {
  it("registers, creates an organisation and seeds a chart of accounts", async () => {
    const u = await newUser({ currency: "PKR", businessName: "Karachi Traders" });
    const me = await u.api.auth.me();
    expect(me?.organisation?.name).toBe("Karachi Traders");
    expect(me?.organisation?.currency).toBe("PKR");
    expect(me?.organisation?.onboardingComplete).toBe(true);
    const accounts = await db.chartAccount.count({ where: { organisationId: u.orgId } });
    expect(accounts).toBeGreaterThan(20);
  });

  it("does not reveal whether an email is already registered", async () => {
    const u = await newUser();
    const again = await callerFor(null).auth.register({
      name: "Someone",
      email: u.email,
      password: "another-pass-1",
    });
    expect(again).toEqual({ success: true });
    expect(await db.user.count({ where: { email: u.email } })).toBe(1);
  });

  it("offers currencies and seeded tax regimes during onboarding", async () => {
    const u = await newUser();
    const currencies = await callerFor(null).org.getCurrencies();
    expect(currencies.map((c) => c.code)).toContain("PKR");
    const regimes = await u.api.org.getTaxRegimes();
    expect(regimes.length).toBeGreaterThan(0);
  });

  it("rejects signed-out access to organisation data", async () => {
    await expect(callerFor(null).org.get()).rejects.toThrow(/UNAUTHORIZED/);
  });
});
