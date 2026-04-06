import { NextRequest } from "next/server";
import { proxyBlogRequest } from "@/app/api/_lib/blogProxy";

export async function GET(req: NextRequest) {
  return proxyBlogRequest(req, "/super-admin/blogs");
}

export async function POST(req: NextRequest) {
  return proxyBlogRequest(req, "/super-admin/blogs");
}
