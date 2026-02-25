import { NextRequest } from "next/server";
import JSZip from "jszip";
import sharp from "sharp";

/**
 * Export a diagram as a VSDX (Microsoft Visio) file.
 * Creates a valid Open XML VSDX with the diagram image embedded inline.
 * 
 * Visio VSDX requires very specific XML structure — this implementation
 * follows the MS-VSDX specification for a minimal valid file.
 */

const NS = "http://schemas.microsoft.com/office/visio/2012/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export async function POST(request: NextRequest) {
  try {
    const { svg, title } = await request.json();

    if (!svg || typeof svg !== "string") {
      return new Response(JSON.stringify({ error: "SVG content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Convert SVG to PNG
    let pngBuffer: Buffer;
    try {
      pngBuffer = await sharp(Buffer.from(svg, "utf-8"), { density: 150 })
        .resize({ width: 3200, height: 2400, fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer();
    } catch (sharpErr: any) {
      console.error("Sharp SVG->PNG conversion failed:", sharpErr.message);
      pngBuffer = await sharp({
        create: { width: 800, height: 600, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
      }).png().toBuffer();
    }

    const metadata = await sharp(pngBuffer).metadata();
    const imgW = metadata.width || 800;
    const imgH = metadata.height || 600;

    // Visio uses inches for dimensions. At 96 DPI screen:
    const dpi = 96;
    const widthInch = imgW / dpi;
    const heightInch = imgH / dpi;
    const pageW = Math.max(widthInch + 1, 11);  // min letter width
    const pageH = Math.max(heightInch + 1, 8.5);
    const pinX = pageW / 2;
    const pinY = pageH / 2;

    const diagramTitle = title || "Architecture Diagram";
    const pngBase64 = pngBuffer.toString("base64");
    const now = new Date().toISOString();

    const zip = new JSZip();

    // === [Content_Types].xml ===
    zip.file("[Content_Types].xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/>
  <Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/>
  <Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/>
  <Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`);

    // === _rels/.rels ===
    zip.file("_rels/.rels",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);

    // === docProps/core.xml ===
    zip.file("docProps/core.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(diagramTitle)}</dc:title>
  <dc:creator>DiagramAgent</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);

    // === docProps/app.xml ===
    zip.file("docProps/app.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Visio</Application>
  <AppVersion>16.0000</AppVersion>
  <Pages>1</Pages>
</Properties>`);

    // === visio/document.xml ===
    zip.file("visio/document.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<VisioDocument xmlns="${NS}" xmlns:r="${NS_R}" xml:space="preserve">
  <DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0">
    <GlueSettings>9</GlueSettings>
    <SnapSettings>65847</SnapSettings>
    <SnapExtensions>34</SnapExtensions>
    <DynamicGridEnabled>1</DynamicGridEnabled>
    <ProtectStyles>0</ProtectStyles>
    <ProtectShapes>0</ProtectShapes>
    <ProtectMasters>0</ProtectMasters>
    <ProtectBkgnds>0</ProtectBkgnds>
  </DocumentSettings>
  <Colors>
    <ColorEntry IX="0" RGB="#000000"/>
    <ColorEntry IX="1" RGB="#FFFFFF"/>
    <ColorEntry IX="2" RGB="#FF0000"/>
    <ColorEntry IX="3" RGB="#00FF00"/>
    <ColorEntry IX="4" RGB="#0000FF"/>
    <ColorEntry IX="5" RGB="#FFFF00"/>
    <ColorEntry IX="6" RGB="#FF00FF"/>
    <ColorEntry IX="7" RGB="#00FFFF"/>
  </Colors>
  <FaceNames>
    <FaceName ID="1" Name="Calibri" UnicodeRanges="-536859905 -1073732485 9 0" CharSets="536871943 0" Panos="2 15 5 2 2 2 4 3 2 4"/>
  </FaceNames>
  <StyleSheets>
    <StyleSheet ID="0" Name="No Style" NameU="No Style" IsCustomName="0" IsCustomNameU="0">
      <Cell N="EnableLineProps" V="1"/>
      <Cell N="EnableFillProps" V="1"/>
      <Cell N="EnableTextProps" V="1"/>
      <Cell N="LineWeight" V="0.01041666666666667"/>
      <Cell N="LineColor" V="0"/>
      <Cell N="LinePattern" V="1"/>
      <Cell N="FillForegnd" V="#ffffff"/>
      <Cell N="FillBkgnd" V="#000000"/>
      <Cell N="FillPattern" V="0"/>
      <Cell N="Char.Font" V="1"/>
      <Cell N="Char.Color" V="0"/>
      <Cell N="Char.Size" V="0.1666666666666667" U="IN"/>
      <Cell N="Para.HorzAlign" V="1"/>
    </StyleSheet>
  </StyleSheets>
</VisioDocument>`);

    // === visio/_rels/document.xml.rels ===
    zip.file("visio/_rels/document.xml.rels",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/pages" Target="pages/pages.xml"/>
  <Relationship Id="rId2" Type="http://schemas.microsoft.com/visio/2010/relationships/windows" Target="windows.xml"/>
</Relationships>`);

    // === visio/windows.xml (required by Visio) ===
    zip.file("visio/windows.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Windows xmlns="${NS}" xmlns:r="${NS_R}" ClientWidth="1920" ClientHeight="1080">
  <Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowLeft="-8" WindowTop="-8" WindowWidth="1936" WindowHeight="1056"
    ContainerType="Page" Page="0" ViewScale="-1" ViewCenterX="${pinX}" ViewCenterY="${pinY}">
    <ShowRulers>1</ShowRulers>
    <ShowGrid>1</ShowGrid>
    <ShowPageBreaks>0</ShowPageBreaks>
    <ShowGuides>1</ShowGuides>
    <ShowConnectionPoints>1</ShowConnectionPoints>
    <GlueSettings>9</GlueSettings>
    <SnapSettings>65847</SnapSettings>
    <SnapExtensions>34</SnapExtensions>
    <TabSplitterPos>0.5</TabSplitterPos>
  </Window>
</Windows>`);

    // === visio/pages/pages.xml ===
    zip.file("visio/pages/pages.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Pages xmlns="${NS}" xmlns:r="${NS_R}">
  <Page ID="0" Name="${escapeXml(diagramTitle)}" NameU="Page-1" IsCustomName="1" IsCustomNameU="0" ViewScale="-1" ViewCenterX="${pinX}" ViewCenterY="${pinY}">
    <PageSheet>
      <Cell N="PageWidth" V="${pageW}" U="IN"/>
      <Cell N="PageHeight" V="${pageH}" U="IN"/>
      <Cell N="ShdwOffsetX" V="0.125" U="IN"/>
      <Cell N="ShdwOffsetY" V="-0.125" U="IN"/>
      <Cell N="PageScale" V="1" U="IN"/>
      <Cell N="DrawingScale" V="1" U="IN"/>
      <Cell N="DrawingSizeType" V="1"/>
      <Cell N="DrawingScaleType" V="0"/>
      <Cell N="InhibitSnap" V="0"/>
      <Cell N="UIVisibility" V="0"/>
      <Cell N="ShdwType" V="0"/>
      <Cell N="ShdwObliqueAngle" V="0"/>
      <Cell N="ShdwScaleFactor" V="1"/>
      <Cell N="PageLockReplace" V="0" U="BOOL"/>
      <Cell N="PageLockDuplicate" V="0" U="BOOL"/>
    </PageSheet>
    <Rel r:id="rId1"/>
  </Page>
</Pages>`);

    // === visio/pages/_rels/pages.xml.rels ===
    zip.file("visio/pages/_rels/pages.xml.rels",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/page" Target="page1.xml"/>
</Relationships>`);

    // === visio/pages/page1.xml ===
    // ForeignData with inline base64 PNG (no external relationship needed)
    zip.file("visio/pages/page1.xml",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<PageContents xmlns="${NS}" xmlns:r="${NS_R}">
  <Shapes>
    <Shape ID="1" Type="Foreign" NameU="DiagramImage" IsCustomNameU="1" Name="${escapeXml(diagramTitle)}">
      <Cell N="PinX" V="${pinX}" U="IN"/>
      <Cell N="PinY" V="${pinY}" U="IN"/>
      <Cell N="Width" V="${widthInch}" U="IN"/>
      <Cell N="Height" V="${heightInch}" U="IN"/>
      <Cell N="LocPinX" V="${widthInch / 2}" F="Width*0.5" U="IN"/>
      <Cell N="LocPinY" V="${heightInch / 2}" F="Height*0.5" U="IN"/>
      <Cell N="Angle" V="0"/>
      <Cell N="FlipX" V="0"/>
      <Cell N="FlipY" V="0"/>
      <Cell N="ResizeMode" V="0"/>
      <Cell N="ImgOffsetX" V="0" U="IN"/>
      <Cell N="ImgOffsetY" V="0" U="IN"/>
      <Cell N="ImgWidth" V="${widthInch}" U="IN"/>
      <Cell N="ImgHeight" V="${heightInch}" U="IN"/>
      <ForeignData ForeignType="Bitmap" CompressionType="PNG" ObjectWidth="${widthInch}" ObjectHeight="${heightInch}">
        <Rel r:id="rId1"/>
      </ForeignData>
    </Shape>
  </Shapes>
</PageContents>`);

    // === visio/pages/_rels/page1.xml.rels ===
    zip.file("visio/pages/_rels/page1.xml.rels",
`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`);

    // === visio/media/image1.png ===
    zip.file("visio/media/image1.png", pngBuffer);

    // Generate the VSDX file
    const vsdxBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });

    return new Response(new Uint8Array(vsdxBuffer), {
      headers: {
        "Content-Type": "application/vnd.ms-visio.drawing",
        "Content-Disposition": `attachment; filename="${sanitizeFilename(diagramTitle)}.vsdx"`,
        "Content-Length": String(vsdxBuffer.length),
      },
    });
  } catch (error: any) {
    console.error("VSDX export error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Failed to export VSDX" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function sanitizeFilename(str: string): string {
  return str.replace(/[^a-zA-Z0-9_\- ]/g, "").substring(0, 100) || "diagram";
}
