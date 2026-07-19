import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { remark } from "remark";
import html from "remark-html";

const BLOG_DIR = path.join(process.cwd(), "content/blog");

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  readingTime: number;
  tags: string[];
  content?: string;
}

function estimateReadingTime(text: string): number {
  const words = text.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function getAllPosts(): BlogPost[] {
  if (!fs.existsSync(BLOG_DIR)) return [];

  const files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));

  return files
    .map((file) => {
      const slug = file.replace(/\.md$/, "");
      const raw = fs.readFileSync(path.join(BLOG_DIR, file), "utf-8");
      const { data, content } = matter(raw);

      return {
        slug,
        title: String(data.title ?? slug),
        description: String(data.description ?? ""),
        publishedAt: String(data.publishedAt ?? ""),
        readingTime: estimateReadingTime(content),
        tags: Array.isArray(data.tags) ? data.tags : [],
      };
    })
    .filter((p) => p.publishedAt)
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
}

export async function getPost(slug: string): Promise<BlogPost | null> {
  const filePath = path.join(BLOG_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

  const processed = await remark().use(html, { sanitize: false }).process(content);

  return {
    slug,
    title: String(data.title ?? slug),
    description: String(data.description ?? ""),
    publishedAt: String(data.publishedAt ?? ""),
    readingTime: estimateReadingTime(content),
    tags: Array.isArray(data.tags) ? data.tags : [],
    content: processed.toString(),
  };
}
