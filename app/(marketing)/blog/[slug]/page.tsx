import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllPosts, getPost } from "@/lib/blog";

interface Props {
  params: Promise<{ slug: string }>;
}

export const dynamicParams = false;

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return {};
  return {
    title: `${post.title} — Trivio Blog`,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.publishedAt,
    },
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <div className="min-h-screen bg-[hsl(38,30%,97%)]">
      {/* Hero */}
      <div className="bg-[hsl(222,35%,8%)] px-6 pt-16 pb-12 text-center">
        {post.tags.length > 0 && (
          <div className="flex justify-center gap-2 mb-4">
            {post.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1 rounded-full bg-white/10 text-white/60"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <h1 className="text-3xl md:text-4xl font-bold text-white max-w-2xl mx-auto leading-tight">
          {post.title}
        </h1>
        <div className="mt-4 flex items-center justify-center gap-3 text-sm text-white/40">
          <span>{formatDate(post.publishedAt)}</span>
          <span>·</span>
          <span>{post.readingTime} min read</span>
        </div>
      </div>

      {/* Article */}
      <div className="max-w-2xl mx-auto px-6 py-14">
        <article
          className="prose prose-stone prose-lg max-w-none
            prose-headings:font-bold prose-headings:text-foreground
            prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
            prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
            prose-p:text-foreground/80 prose-p:leading-relaxed
            prose-a:text-primary prose-a:no-underline hover:prose-a:underline
            prose-strong:text-foreground
            prose-ul:text-foreground/80 prose-ol:text-foreground/80
            prose-li:my-1
            prose-hr:border-border/40
            prose-blockquote:border-primary/40 prose-blockquote:text-muted-foreground
            prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:before:content-none prose-code:after:content-none"
          dangerouslySetInnerHTML={{ __html: post.content ?? "" }}
        />

        {/* Back link */}
        <div className="mt-16 pt-8 border-t border-border/40">
          <Link
            href="/blog"
            className="text-sm font-semibold text-primary hover:underline"
          >
            ← Back to Blog
          </Link>
        </div>
      </div>
    </div>
  );
}
