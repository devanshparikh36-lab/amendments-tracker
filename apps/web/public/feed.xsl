<?xml version="1.0" encoding="utf-8"?>
<!--
  Makes the Atom feed readable when it is opened in a browser.

  A feed is XML and is meant for Outlook, Teams or a reader — but the footer carries a "Feed" link, and
  somebody who follows it in a browser gets a wall of markup that reads as a broken page. This transforms
  that wall into something a person can understand, and tells them what the thing in their address bar is
  actually for.

  Nothing about the feed itself changes. Readers ignore the stylesheet entirely: it is a processing
  instruction a browser acts on and a parser skips, so the Atom stays byte-for-byte valid.

  XSLT 1.0, because that is what browsers implement and the version has not moved in twenty years. Served
  from /public so it is a static file on the CDN rather than a function.

  Styling is inline and duplicated from globals.css rather than imported: a stylesheet applied to XML
  cannot reach the app's CSS, and a <link> to it would be a second request for a page most people will see
  once. The colours are the light-theme tokens; dark mode is not attempted, because a browser rendering raw
  XML is already an unusual enough place to be without guessing at its theme.
-->
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">

  <xsl:output method="html" encoding="utf-8" indent="yes" />

  <xsl:template match="/atom:feed">
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title><xsl:value-of select="atom:title" /> — feed</title>
        <style>
          :root { color-scheme: light; }
          body {
            margin: 0; padding: 28px 18px; background: #faf9f7; color: #1c1917;
            font: 400 15px/1.65 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          .wrap { max-width: 44rem; margin: 0 auto; }
          h1 { font: 600 24px/1.25 Georgia, "Times New Roman", serif; margin: 0 0 4px; }
          .sub { color: #57534e; margin: 0 0 20px; }
          .note {
            background: #fff; border: 1px solid #e7e5e4; border-radius: 4px;
            padding: 14px 16px; margin: 0 0 24px; font-size: 13.5px; color: #44403c;
          }
          .note b { color: #1c1917; }
          .note code {
            font: 400 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
            background: #faf9f7; border: 1px solid #e7e5e4; border-radius: 3px; padding: 1px 5px;
            word-break: break-all;
          }
          .count { font-size: 12px; color: #78716c; letter-spacing: .06em; text-transform: uppercase; margin: 0 0 10px; }
          ul { list-style: none; margin: 0; padding: 0; }
          li { border-top: 1px solid #e7e5e4; padding: 14px 0; }
          a { color: #14532d; }
          .title { font-size: 15px; font-weight: 500; }
          .meta { font-size: 12.5px; color: #78716c; margin-top: 3px; }
          .meta a { color: #78716c; }
          footer { border-top: 1px solid #e7e5e4; margin-top: 24px; padding-top: 14px; font-size: 12.5px; color: #78716c; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <h1><xsl:value-of select="atom:title" /></h1>
          <p class="sub"><xsl:value-of select="atom:subtitle" /></p>

          <div class="note">
            <b>This is a feed, not a page.</b> You are looking at it in a browser, which is why it arrived
            formatted like this. Paste the address below into Outlook, Teams, or any feed reader and it will
            tell you whenever a regulator publishes something.
            <div style="padding-top:8px">
              <code><xsl:value-of select="atom:link[@rel='self']/@href" /></code>
            </div>
            <div style="padding-top:8px">
              It can be narrowed to one regulator or one instrument &#8212; add
              <code>?regulator=CBDT</code> or <code>?instrument=cgst-act-2017</code> to that address.
            </div>
          </div>

          <p class="count"><xsl:value-of select="count(atom:entry)" /> most recent</p>

          <ul>
            <xsl:for-each select="atom:entry">
              <li>
                <div class="title">
                  <a href="{atom:link[@rel='alternate']/@href}"><xsl:value-of select="atom:title" /></a>
                </div>
                <div class="meta">
                  <xsl:value-of select="atom:summary" />
                  <xsl:if test="atom:link[@rel='related']">
                    <xsl:text> &#183; </xsl:text>
                    <a href="{atom:link[@rel='related']/@href}">the regulator&#8217;s own document</a>
                  </xsl:if>
                </div>
              </li>
            </xsl:for-each>
          </ul>

          <footer>
            <a href="/">As Amended</a> &#183; Amendments are shown as references and are never applied to the
            statutory text. A research aid, not legal advice.
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
