import type { Metadata } from "next";
import Link from "next/link";
import { getAllPosts } from "@/lib/blog";

export const metadata: Metadata = {
  title: "Blog — Trivio",
  description: "Practical guides on freelance finances, bookkeeping, invoicing, and taxes. Written for people who didn't go to school for this.",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen bg-[hsl(38,30%,97%)]">
      {/* Hero */}
      <div className="bg-[hsl(222,35%,8%)] px-6 py-20 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-white/40 mb-3">Blog</p>
        <h1 className="text-4xl font-bold text-white">
          Freelance finances,{" "}
          <span className="text-[hsl(150,40%,65%)]">without the jargon</span>
        </h1>
        <p className="mt-4 text-lg text-white/60 max-w-xl mx-auto">
          Practical guides on invoicing, taxes, and tracking money — written for people who didn&apos;t go to school for this.
        </p>
      </div>

      {/* Post list */}
      <div className="max-w-3xl mx-auto px-6 py-16">
        {posts.length === 0 ? (
          <p className="text-muted-foreground text-center py-16">No posts yet. Check back soon.</p>
        ) : (
          <div className="flex flex-col gap-8">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group block bg-white rounded-2xl border border-border/40 shadow-card p-7 hover:shadow-md transition-shadow"
              >
                {post.tags.length > 0 && (
                  <div className="flex gap-2 mb-3">
                    {post.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1 rounded-full bg-primary/10 text-primary"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <h2 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors leading-snug">
                  {post.title}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {post.description}
                </p>
                <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{formatDate(post.publishedAt)}</span>
                  <span>·</span>
                  <span>{post.readingTime} min read</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
