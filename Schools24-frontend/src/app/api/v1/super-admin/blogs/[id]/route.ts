import { NextRequest } from "next/server";
import { proxyBlogRequest } from "@/app/api/_lib/blogProxy";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyBlogRequest(req, `/super-admin/blogs/${id}`);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyBlogRequest(req, `/super-admin/blogs/${id}`);
}
