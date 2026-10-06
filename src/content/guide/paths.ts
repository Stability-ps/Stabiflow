// Kept separate from the chapter content so product pages can link into the
// guide without pulling every chapter into the main bundle.
export function chapterPath(slug: string, section?: string): string {
  return `/app/guide/${slug}${section ? `#${section}` : ""}`;
}
