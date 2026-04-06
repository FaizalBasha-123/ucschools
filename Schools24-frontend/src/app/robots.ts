import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/blogs", "/blog/"],
      disallow: ["/admin/", "/teacher/", "/student/", "/super-admin/", "/driver/", "/api/"],
    },
    sitemap: "https://schools24.in/sitemap.xml",
  }
}

