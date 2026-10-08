import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import Content from "./Content";

function renderContent(path = "/app/content") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/content" element={<Content />}>
          <Route index element={<Navigate to="media-library" replace />} />
          <Route path="media-library" element={<div>MEDIA VIEW</div>} />
          <Route path="calendar" element={<div>CALENDAR VIEW</div>} />
          <Route path="scheduled" element={<div>SCHEDULED VIEW</div>} />
          <Route path="published" element={<div>PUBLISHED VIEW</div>} />
          <Route path="drafts" element={<div>DRAFTS VIEW</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("Content navigation", () => {
  afterEach(cleanup);

  it("defaults to Media Library and renders it as the first tab", () => {
    renderContent();
    expect(screen.getByText("MEDIA VIEW")).toBeInTheDocument();
    const tabs = screen.getAllByRole("link");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Media Library", "Calendar", "Scheduled", "Published", "Drafts"]);
    expect(tabs[0]).toHaveAttribute("aria-current", "page");
  });

  it.each([
    ["calendar", "CALENDAR VIEW"],
    ["scheduled", "SCHEDULED VIEW"],
    ["published", "PUBLISHED VIEW"],
    ["drafts", "DRAFTS VIEW"],
  ])("preserves a deep link to %s", (section, expected) => {
    renderContent(`/app/content/${section}`);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
