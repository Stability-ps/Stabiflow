import { useEffect } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import { BookX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { getChapter } from "@/content/guide";
import { GuideBook } from "@/components/guide/GuideBook";
import { GuideChapterView } from "@/components/guide/GuideChapterView";
import { GuideHome } from "@/components/guide/GuideHome";
import { GuideSearch } from "@/components/guide/GuideSearch";
import { GuideMobileNav, GuideSidebar } from "@/components/guide/GuideSidebar";

/** Sets the tab title while mounted and restores the previous one on leave. */
function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => { document.title = previous; };
  }, [title]);
}

function ChapterRoute() {
  const { slug } = useParams();
  const chapter = getChapter(slug);
  useDocumentTitle(chapter ? `${chapter.title} · StabiFlow Guide` : "StabiFlow Guide");
  if (!chapter) {
    return (
      <EmptyState
        icon={BookX}
        title="Guide article not found"
        description="That article doesn't exist or may have moved. Search the guide or browse the chapters."
        action={<Button asChild><Link to="/app/guide">Go to the guide</Link></Button>}
      />
    );
  }
  return <GuideChapterView chapter={chapter} />;
}

function GuideShell({ children, showSearch = true }: { children: React.ReactNode; showSearch?: boolean }) {
  return (
    <div className="guide-root mx-auto w-full max-w-[1280px]" data-testid="guide">
      <GuideMobileNav />
      <div className="flex gap-8 pt-4 xl:pt-0">
        <GuideSidebar />
        <div className="min-w-0 flex-1">
          {showSearch && <GuideSearch className="mb-6 max-w-xl" />}
          <div className="max-w-3xl">{children}</div>
        </div>
      </div>
    </div>
  );
}

function GuideHomeRoute() {
  useDocumentTitle("StabiFlow Guide");
  return (
    <div className="guide-root mx-auto w-full max-w-[1280px]" data-testid="guide">
      <GuideMobileNav />
      <div className="flex gap-8 pt-4 xl:pt-0">
        <GuideSidebar />
        <div className="min-w-0 flex-1"><GuideHome /></div>
      </div>
    </div>
  );
}

/** /app/guide - the StabiFlow Guide. Never feature-gated. */
export default function Guide() {
  return (
    <Routes>
      <Route index element={<GuideHomeRoute />} />
      <Route path="book" element={<GuideBook />} />
      <Route path=":slug" element={<GuideShell><ChapterRoute /></GuideShell>} />
      <Route path="*" element={<GuideShell><ChapterRoute /></GuideShell>} />
    </Routes>
  );
}
