import React from 'react';
import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'MySchools';
const SITE_URL  = 'https://myschools.in';
const DEFAULT_IMAGE = `${SITE_URL}/og-image.png`;

interface SEOMetaProps {
  /** Page-specific title — will be appended with " | MySchools" */
  title: string;
  description: string;
  /** Canonical path, e.g. "/about". Defaults to current pathname. */
  path?: string;
  /** Override the full canonical URL */
  canonicalUrl?: string;
  ogImage?: string;
  ogType?: 'website' | 'article';
  /** JSON-LD structured data objects to inject as <script type="application/ld+json"> */
  structuredData?: object | object[];
  noIndex?: boolean;
  keywords?: string;
}

const SEOMeta: React.FC<SEOMetaProps> = ({
  title,
  description,
  path,
  canonicalUrl,
  ogImage = DEFAULT_IMAGE,
  ogType = 'website',
  structuredData,
  noIndex = false,
  keywords,
}) => {
  const fullTitle = `${title} | ${SITE_NAME}`;
  const canonical = canonicalUrl ?? (path ? `${SITE_URL}${path}` : SITE_URL);

  const schemas = structuredData
    ? Array.isArray(structuredData)
      ? structuredData
      : [structuredData]
    : [];

  return (
    <Helmet>
      {/* Core */}
      <title>{fullTitle}</title>
      <meta name="description" content={description} />
      {keywords && <meta name="keywords" content={keywords} />}
      <link rel="canonical" href={canonical} />
      <meta
        name="robots"
        content={
          noIndex
            ? 'noindex, nofollow'
            : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'
        }
      />

      {/* Open Graph */}
      <meta property="og:type"        content={ogType} />
      <meta property="og:url"         content={canonical} />
      <meta property="og:title"       content={fullTitle} />
      <meta property="og:description" content={description} />
      <meta property="og:image"       content={ogImage} />
      <meta property="og:image:width"  content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:site_name"   content={SITE_NAME} />
      <meta property="og:locale"      content="en_IN" />

      {/* Twitter */}
      <meta name="twitter:card"        content="summary_large_image" />
      <meta name="twitter:url"         content={canonical} />
      <meta name="twitter:title"       content={fullTitle} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image"       content={ogImage} />
      <meta name="twitter:creator"     content="@myschoolsin" />

      {/* Geo targeting */}
      <meta name="geo.region"     content="IN" />
      <meta name="geo.placename"  content="India" />
      <meta name="language"       content="English" />

      {/* hreflang: India-primary English content */}
      <link rel="alternate" hrefLang="en-IN" href={canonical} />
      <link rel="alternate" hrefLang="en"    href={canonical} />
      <link rel="alternate" hrefLang="x-default" href={canonical} />

      {/* AI / LLM crawlers: point to structured site summary */}
      <link rel="alternate" type="text/markdown" href="https://schools24.in/llms.txt" title="LLM-readable site overview" />

      {/* Per-page structured data */}
      {schemas.map((schema, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(schema)}
        </script>
      ))}
    </Helmet>
  );
};

export default SEOMeta;
