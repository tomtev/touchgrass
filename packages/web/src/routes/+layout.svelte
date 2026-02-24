<script>
  import '../app.css';
  let { children } = $props();

  const siteUrl = 'https://touchgrass.sh';
  const pageTitle = 'touchgrass.sh | Remote control Claude Code, Codex, Pi and more';
  const pageDescription = 'Remote control Claude Code, Codex, and more from Telegram. Send prompts, approve tools, and manage sessions from your phone.';
  const ogImageUrl = `${siteUrl}/og.png`;
  const seoSchema = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'touchgrass.sh',
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'macOS, Linux, Windows',
    description: pageDescription,
    url: siteUrl,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
  };
</script>

<svelte:head>
  <title>{pageTitle}</title>
  <meta name="description" content={pageDescription} />
  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
  <meta name="keywords" content="touchgrass, telegram bot, claude code, codex, kimi, pi, remote terminal, ai cli controller" />
  <meta name="author" content="touchgrass.sh" />
  <meta name="theme-color" content="#04090a" />
  <link rel="canonical" href={siteUrl} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="touchgrass.sh" />
  <meta property="og:url" content={siteUrl} />
  <meta property="og:title" content={pageTitle} />
  <meta property="og:description" content={pageDescription} />
  <meta property="og:image" content={ogImageUrl} />
  <meta property="og:image:alt" content="touchgrass terminal bridge hero preview" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={pageTitle} />
  <meta name="twitter:description" content={pageDescription} />
  <meta name="twitter:image" content={ogImageUrl} />
  {@html `<script type="application/ld+json">${JSON.stringify(seoSchema)}<\/script>`}
</svelte:head>

{@render children()}
