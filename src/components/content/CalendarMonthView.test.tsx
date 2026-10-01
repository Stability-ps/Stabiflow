// Device-QA defect H2 (pre-existing on main): the calendar day dialog's post
// list is a grid item of DialogContent. Without min-w-0 the implicit grid
// column grows to the widest one-line (truncate) caption, so cards and the
// date title were pushed hundreds of pixels outside the dialog. Layout is
// verified in the browser; this guards the class chain that makes it shrink.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarMonthView } from "./CalendarMonthView";

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "ws-1" }) }));
vi.mock("@/components/content/MediaPreview", () => ({ MediaPreview: () => <span data-testid="media" /> }));
const longCaption = "An extremely long caption that is one unbreakable-looking line ".repeat(6);
const today = new Date();
today.setHours(12, 0, 0, 0);
vi.mock("@/hooks/useContentScheduledPosts", () => ({
  useContentScheduledPosts: () => ({
    isLoading: false,
    data: Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`, scheduled_at: new Date(today.getTime() + i * 60_000).toISOString(), status: "scheduled", target_platform: "linkedin",
      caption: `${i + 1}. ${longCaption}`, content_media_assets: { title: "asset", storage_path: "ws-1/a.png" },
    })),
  }),
}));

describe("CalendarMonthView day dialog", () => {
  afterEach(cleanup);

  it("keeps long captions inside the dialog: the grid item can shrink and captions truncate", () => {
    render(<CalendarMonthView workspaceTimezone="Africa/Johannesburg" />);
    const day = screen.getAllByRole("button").find((b) => b.textContent?.includes("+"))!;
    fireEvent.click(day);
    const dialog = screen.getByRole("dialog");
    // Title (the date) is present in the dialog.
    expect(within(dialog).getByRole("heading")).toHaveTextContent(new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(today));
    const caption = within(dialog).getByText(/^1\. An extremely long caption/);
    expect(caption.className).toMatch(/\btruncate\b/);
    // Caption's flex column may shrink ...
    expect(caption.parentElement!.className).toMatch(/\bmin-w-0\b/);
    // ... and so may the list, the DialogContent grid item (the H2 fix).
    const list = caption.parentElement!.parentElement!.parentElement!;
    expect(list.parentElement).toBe(dialog);
    expect(list.className).toMatch(/\bmin-w-0\b/);
    expect(within(list).getAllByText(/An extremely long caption/)).toHaveLength(12);
  });
});
