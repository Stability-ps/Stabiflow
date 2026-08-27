// Unit tests for the CLIENT-SIDE mirror of has_workspace_permission()
// (20260901060000_leads_pipelines_schema.sql's role grants). This is a
// UX-only mirror - has_workspace_permission() in Postgres is the real
// authorization boundary - but it must stay behaviorally identical, or the
// Leads/Pipelines/Opportunities UI would offer controls the backend
// silently rejects (or hide ones it would actually allow).
import { describe, expect, it } from "vitest";
import { roleHasPermission } from "./permissions";

describe("roleHasPermission - Leads/Pipelines/Opportunities (Phase E)", () => {
  it("grants sales the full day-to-day lead/opportunity toolkit but not pipeline.manage", () => {
    expect(roleHasPermission("sales", "lead.view")).toBe(true);
    expect(roleHasPermission("sales", "lead.create")).toBe(true);
    expect(roleHasPermission("sales", "lead.edit")).toBe(true);
    expect(roleHasPermission("sales", "lead.assign")).toBe(true);
    expect(roleHasPermission("sales", "opportunity.create")).toBe(true);
    expect(roleHasPermission("sales", "opportunity.close")).toBe(true);
    expect(roleHasPermission("sales", "pipeline.view")).toBe(true);
    expect(roleHasPermission("sales", "pipeline.manage")).toBe(false);
  });

  it("grants support view/create on leads (a conversation they handle may need one) but not edit/assign/close", () => {
    expect(roleHasPermission("support", "lead.view")).toBe(true);
    expect(roleHasPermission("support", "lead.create")).toBe(true);
    expect(roleHasPermission("support", "lead.edit")).toBe(false);
    expect(roleHasPermission("support", "lead.assign")).toBe(false);
    expect(roleHasPermission("support", "opportunity.create")).toBe(false);
    expect(roleHasPermission("support", "opportunity.close")).toBe(false);
  });

  it("grants marketing and viewer view-only access, same as content.view/campaign.view", () => {
    for (const role of ["marketing", "viewer"] as const) {
      expect(roleHasPermission(role, "lead.view")).toBe(true);
      expect(roleHasPermission(role, "pipeline.view")).toBe(true);
      expect(roleHasPermission(role, "opportunity.view")).toBe(true);
      expect(roleHasPermission(role, "lead.create")).toBe(false);
      expect(roleHasPermission(role, "pipeline.manage")).toBe(false);
      expect(roleHasPermission(role, "opportunity.create")).toBe(false);
    }
  });

  it("grants manager-and-up pipeline.manage (workspace sales-process configuration)", () => {
    expect(roleHasPermission("owner", "pipeline.manage")).toBe(true);
    expect(roleHasPermission("admin", "pipeline.manage")).toBe(true);
    expect(roleHasPermission("manager", "pipeline.manage")).toBe(true);
    expect(roleHasPermission("sales", "pipeline.manage")).toBe(false);
    expect(roleHasPermission("support", "pipeline.manage")).toBe(false);
  });

  it("returns false for a null/undefined role rather than throwing", () => {
    expect(roleHasPermission(null, "lead.view")).toBe(false);
    expect(roleHasPermission(undefined, "opportunity.view")).toBe(false);
  });
});

describe("roleHasPermission - Attribution/Revenue (Phase G)", () => {
  it("grants attribution.view broadly, like content.view/campaign.view, but attribution.manage only manager-and-up", () => {
    for (const role of ["owner", "admin", "manager", "marketing", "sales", "support", "viewer"] as const) {
      expect(roleHasPermission(role, "attribution.view")).toBe(true);
    }
    expect(roleHasPermission("owner", "attribution.manage")).toBe(true);
    expect(roleHasPermission("admin", "attribution.manage")).toBe(true);
    expect(roleHasPermission("manager", "attribution.manage")).toBe(true);
    expect(roleHasPermission("marketing", "attribution.manage")).toBe(false);
    expect(roleHasPermission("sales", "attribution.manage")).toBe(false);
    expect(roleHasPermission("support", "attribution.manage")).toBe(false);
    expect(roleHasPermission("viewer", "attribution.manage")).toBe(false);
  });

  it("grants revenue.view broadly, but revenue.create/edit only to roles that close deals (owner/admin/manager/sales)", () => {
    for (const role of ["owner", "admin", "manager", "marketing", "sales", "support", "viewer"] as const) {
      expect(roleHasPermission(role, "revenue.view")).toBe(true);
    }
    expect(roleHasPermission("owner", "revenue.create")).toBe(true);
    expect(roleHasPermission("sales", "revenue.create")).toBe(true);
    expect(roleHasPermission("marketing", "revenue.create")).toBe(false);
    expect(roleHasPermission("viewer", "revenue.create")).toBe(false);
  });
});

describe("roleHasPermission - Flow AI (Phase I)", () => {
  it("grants flow_ai.use to every role, broadly like content.view/campaign.view", () => {
    for (const role of ["owner", "admin", "manager", "marketing", "sales", "support", "viewer"] as const) {
      expect(roleHasPermission(role, "flow_ai.use")).toBe(true);
    }
  });

  it("flow_ai.use does not itself imply revenue/analytics visibility - support has flow_ai.use but lacks view_analytics", () => {
    expect(roleHasPermission("support", "flow_ai.use")).toBe(true);
    expect(roleHasPermission("support", "view_analytics")).toBe(false);
  });
});
