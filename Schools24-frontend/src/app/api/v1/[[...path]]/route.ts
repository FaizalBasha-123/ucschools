import { NextRequest } from "next/server";
import { proxyApiRequest } from "@/app/api/_lib/apiProxy";

async function handle(req: NextRequest, pathParts?: string[]) {
  const path = `/${(pathParts || []).join("/")}`;
  return proxyApiRequest(req, path === "/" ? "" : path);
}

export async function GET(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}

export async function POST(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}

export async function PUT(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}

export async function OPTIONS(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}

export async function HEAD(req: NextRequest, context: { params: Promise<{ path?: string[] }> }) {
  return handle(req, (await context.params).path);
}