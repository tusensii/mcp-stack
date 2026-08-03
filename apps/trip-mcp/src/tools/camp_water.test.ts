import { describe, it, expect } from "vitest";
import { CAMPING } from "../camping.js";

describe("CAMPING registry (#84 acceptance)", () => {
  it("Enchantments: designated-site zone model, named camps, canister requirement", () => {
    const c = CAMPING["enchantments"]!;
    expect(c.regulation_model).toBe("zone_quota");
    expect(c.named_camps!.length).toBeGreaterThan(0);
    expect(c.food_storage.detail).toMatch(/canister/i);
  });

  it("Glacier Peak: dispersed model with 100-ft rules", () => {
    const c = CAMPING["glacier_peak"]!;
    expect(c.regulation_model).toBe("dispersed_with_rules");
    expect(c.regulation_detail).toMatch(/100 ?ft/);
  });

  it("water reliability notes present for at least 4 areas", () => {
    const withWater = Object.values(CAMPING).filter(
      (c) => c.water_reliability && c.water_reliability.length > 0,
    );
    expect(withWater.length).toBeGreaterThanOrEqual(4);
  });

  it("every fire and food rule cites a governing source URL", () => {
    for (const [id, c] of Object.entries(CAMPING)) {
      expect(c.fire_rules.source_url, `${id} fire_rules missing source`).toMatch(/^https:\/\//);
      expect(c.food_storage.source_url, `${id} food_storage missing source`).toMatch(/^https:\/\//);
      expect(c.food_storage.cross_ref).toMatch(/get_safety_brief/);
      expect(c.permits_pointer).toMatch(/get_permit/);
    }
  });
});
