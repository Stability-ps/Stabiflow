// Content redesign: a failed load is never shown as "nothing here", every
// icon-only control has a name, and status is said in words, not colour.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PostsList } from "./PostsList";
import { MediaLibraryGrid } from "./MediaLibraryGrid";
import { CalendarMonthView } from "./CalendarMonthView";

const { state } = vi.hoisted(() => ({
  state: {
    posts: [] as Array<Record<string, unknown>>,
    postsError: false,
    assets: [] as Array<Record<string, unknown>>,
    assetsError: false,
    refetch: vi.fn(),
    postsArgs: [] as unknown[],
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ currentWorkspaceId: "workspace-1", hasPermission: () => true }) }));
vi.mock("@/hooks/useContentScheduledPosts", () => ({
  useContentScheduledPosts: (...args: unknown[]) => (state.postsArgs = args, { data: state.postsError ? undefined : state.posts, isLoading: false, isError: state.postsError, refetch: state.refetch }),
}));
vi.mock("@/hooks/useContentMediaAssets", () => ({
  useContentMediaAssets: () => ({ data: state.assetsError ? undefined : state.assets, isLoading: false, isError: state.assetsError, refetch: state.refetch }),
}));
vi.mock("@/components/content/MediaPreview", () => ({ MediaPreview: ({ alt }: { alt: string }) => <img alt={alt} /> }));
vi.mock("@/components/content/ComposePostDialog", () => ({ ComposePostDialog: () => null }));

const POST = {
  id: "p1", target_platform: "facebook", media_asset_id: "m1", facebook_page_id: "fb1", instagram_account_id: null,
  scheduled_at: new Date().toISOString(), caption: "Fresh bread every morning", status: "failed",
  failure_message: "Meta rejected the image", provider_permalink: "https://facebook.com/p/1",
  content_media_assets: { title: "bread.jpg", storage_path: "x/bread.jpg" }, workspace_facebook_pages: { page_name: "Ubuntu Bakery" }, workspace_instagram_accounts: null,
};

function wrap(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  state.posts = [];
  state.postsError = false;
  state.assets = [];
  state.assetsError = false;
  state.refetch.mockReset();
});
afterEach(cleanup);

describe("PostsList", () => {
  it("a load error shows a retry state, not the empty message", () => {
    state.postsError = true;
    wrap(<PostsList statusFilter="scheduled" workspaceTimezone="Africa/Johannesburg" emptyTitle="No scheduled posts yet" emptyDescription="x" />);
    expect(screen.getByText("Couldn't load posts")).toBeInTheDocument();
    expect(screen.queryByText("No scheduled posts yet")).not.toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(state.refetch).toHaveBeenCalled();
  });

  it("an empty list still shows the section's empty message", () => {
    wrap(<PostsList statusFilter="scheduled" workspaceTimezone="Africa/Johannesburg" emptyTitle="No scheduled posts yet" emptyDescription="x" />);
    expect(screen.getByText("No scheduled posts yet")).toBeInTheDocument();
  });

  it("shows a worded status, the failure reason, and named icon controls", () => {
    state.posts = [POST];
    wrap(<PostsList statusFilter="scheduled" workspaceTimezone="Africa/Johannesburg" emptyTitle="e" emptyDescription="x" />);
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Meta rejected the image")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Post actions" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View on Facebook/ })).toHaveAttribute("href", "https://facebook.com/p/1");
  });
});

describe("MediaLibraryGrid", () => {
  it("a load error offers Try again", () => {
    state.assetsError = true;
    wrap(<MediaLibraryGrid />);
    expect(screen.getByText("Couldn't load your Media Library")).toBeInTheDocument();
    screen.getByRole("button", { name: "Try again" }).click();
    expect(state.refetch).toHaveBeenCalled();
  });

  it("names the role picker and archive button per asset", () => {
    state.assets = [{ id: "a1", title: "bread.jpg", storage_path: "x", width_px: 1080, height_px: 1080, default_caption: null, asset_role: null, content_platform_variants: [] }];
    wrap(<MediaLibraryGrid />);
    expect(screen.getByRole("combobox", { name: "Role for bread.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archive bread.jpg" })).toBeInTheDocument();
  });
});

describe("CalendarMonthView", () => {
  it("a load error is announced instead of showing a silently empty month", () => {
    state.postsError = true;
    wrap(<CalendarMonthView workspaceTimezone="Africa/Johannesburg" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load this month's posts");
  });

  it("each day says how many posts it has and their status in words", () => {
    state.posts = [{ ...POST, status: "scheduled" }, { ...POST, id: "p2", status: "failed" }];
    wrap(<CalendarMonthView workspaceTimezone="Africa/Johannesburg" />);
    expect(screen.getByRole("button", { name: /2 posts: 1 scheduled, 1 failed/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous month" })).toBeInTheDocument();
  });
});

describe("CalendarMonthView - workspace timezone", () => {
  // Noon UTC on 15 Jan 2026 is already 16 Jan in Kiritimati (UTC+14) and
  // still 15 Jan in Pago Pago (UTC-11). The browser zone running the test
  // can't be both, so bucketing by browser time fails one of these.
  const POST_AT = "2026-01-15T12:00:00.000Z";
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(POST_AT));
    state.postsError = false;
    state.posts = [{ ...POST, scheduled_at: POST_AT, status: "scheduled" }];
  });
  afterEach(() => vi.useRealTimers());

  it("places a post on the workspace's day (UTC+14)", () => {
    wrap(<CalendarMonthView workspaceTimezone="Pacific/Kiritimati" />);
    expect(screen.getByRole("button", { name: /^Friday 16 January, 1 post/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thursday 15 January, no posts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Friday 16 January/ })).toHaveAttribute("aria-current", "date");
  });

  it("places the same post on the workspace's day (UTC-11)", () => {
    wrap(<CalendarMonthView workspaceTimezone="Pacific/Pago_Pago" />);
    expect(screen.getByRole("button", { name: /^Thursday 15 January, 1 post/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Friday 16 January, no posts" })).toBeInTheDocument();
  });

  it("fetches the visible grid's range in workspace midnights", () => {
    wrap(<CalendarMonthView workspaceTimezone="Pacific/Kiritimati" />);
    // Jan 2026 grid: Sun 28 Dec 2025 .. Sat 31 Jan 2026 (inclusive).
    expect(state.postsArgs[2]).toEqual({ from: "2025-12-27T10:00:00.000Z", to: "2026-01-31T10:00:00.000Z" });
  });
});
