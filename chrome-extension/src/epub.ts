import JSZip from "jszip";

// Typography tuned on a reMarkable Paper Pro:
// - absolute pt base (reader ignores/overrides relative em on body)
// - left-aligned (justified text produces terrible word spacing with code identifiers)
// - inline code as a marker-style highlight
export const EPUB_CSS = `
body { font-family: serif; font-size: 9pt; line-height: 1.4; margin: 0; padding: 0; text-align: left; }
p, li, blockquote { text-align: left; }
h1 { font-size: 1.25em; font-weight: bold; margin: 0 0 0.6em; line-height: 1.25; }
h2 { font-size: 1.1em; font-weight: bold; margin: 1.1em 0 0.4em; line-height: 1.3; }
h3 { font-size: 1em; font-weight: bold; margin: 0.9em 0 0.3em; }
h4, h5, h6 { font-size: 1em; font-weight: bold; margin: 0.8em 0 0.3em; }
p { margin: 0 0 0.6em; }
ul, ol { margin: 0 0 0.6em; padding-left: 1.4em; }
li { margin-bottom: 0.2em; }
code { font-family: monospace; font-size: 0.85em; background-color: #ddd; padding: 0.05em 0.3em; border-radius: 0.25em; }
pre { font-family: monospace; font-size: 0.8em; white-space: pre-wrap; overflow-wrap: break-word; margin: 0 0 0.6em; padding: 0.4em; border: 1px solid #999; background-color: #eee; }
pre code { background-color: transparent; padding: 0; border-radius: 0; font-size: 1em; }
blockquote { margin: 0 0 0.6em 0.8em; padding-left: 0.6em; border-left: 2px solid #999; }
table { border-collapse: collapse; margin: 0 0 0.8em; font-size: 0.9em; }
th, td { border: 1px solid #999; padding: 0.25em 0.5em; text-align: left; }
hr { border: none; border-top: 1px solid #999; margin: 1em 0; }
a { color: inherit; }
figure { margin: 0 0 0.8em; }
figcaption { font-size: 0.85em; font-style: italic; }
`;

export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

/**
 * Build a minimal EPUB 3. The nav document is in the manifest (spec
 * requirement) but NOT in the spine, so the reader opens straight into the
 * content without a "Table of Contents" page.
 *
 * `bodyXhtml` must already be well-formed XHTML (serialize with XMLSerializer).
 */
export async function buildEpub(title: string, bodyXhtml: string): Promise<Uint8Array> {
  const escapedTitle = escapeXml(title);
  const uuid = crypto.randomUUID();
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const chapter = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>${escapedTitle}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${bodyXhtml}</body>
</html>`;

  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><title>${escapedTitle}</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${escapedTitle}</a></li></ol></nav></body>
</html>`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapedTitle}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Send to reMarkable (lab)</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="chapter"/>
  </spine>
</package>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", container);
  zip.file("OEBPS/content.opf", opf);
  zip.file("OEBPS/nav.xhtml", nav);
  zip.file("OEBPS/chapter.xhtml", chapter);
  zip.file("OEBPS/style.css", EPUB_CSS);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
