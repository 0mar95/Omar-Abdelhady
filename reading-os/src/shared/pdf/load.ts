// Reads one PDF page through pdf.js into plain data: positioned text runs with
// real font names, and the rectangles covered by drawings and images. This is
// the only file that talks to pdf.js, so the analysis can be tested on plain data.

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { Rect } from "../model.ts";

export interface Run {
  str: string;
  /** Left edge and baseline, PDF points from the top-left corner. */
  x: number;
  y: number;
  w: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  /** Text not running left-to-right horizontally (watermarks, rotated labels). */
  rotated: boolean;
}

export interface Graphic extends Rect {
  kind: "image" | "path";
}

export interface RawPage {
  index: number;
  w: number;
  h: number;
  runs: Run[];
  graphics: Graphic[];
}

/** The subset of the pdf.js module this file needs (OPS codes). */
export interface PdfjsLike {
  OPS: Record<string, number>;
}

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: ArrayLike<number>): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function bboxOf(m: Matrix, x0: number, y0: number, x1: number, y1: number): Rect {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/** "AAAAAC+WarnockPro-LightIt" → "WarnockPro-LightIt". */
export function cleanFontName(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

export function fontStyle(font: string): { bold: boolean; italic: boolean } {
  const style = font.includes("-") ? font.slice(font.lastIndexOf("-") + 1) : font;
  const italic = /italic|oblique|It$|It[A-Z]|Ital/i.test(style) || /Italic|Oblique/i.test(font);
  const bold =
    /bold|black|heavy|semibold|demibold|extrabold|ultra/i.test(style) ||
    /^(Bd|Hv|Blk|Sb|Db|Xb)/.test(style) ||
    /Bd|Hv|Bold|Black|Heavy/.test(style) ||
    /SC700|W[6-9]$/.test(style);
  return { bold, italic };
}

interface TextItemLike {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
}

export async function loadPage(doc: PDFDocumentProxy, index: number, pdfjs: PdfjsLike): Promise<RawPage> {
  const page: PDFPageProxy = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const vt = viewport.transform as unknown as Matrix;
  // The operator list loads fonts into commonObjs, which gives real font names,
  // and tells us where drawings and images are.
  const ops = await page.getOperatorList();
  const content = await page.getTextContent();

  const fontNames = new Map<string, string>();
  const fontFor = (id: string): string => {
    let name = fontNames.get(id);
    if (name === undefined) {
      name = id;
      try {
        if (page.commonObjs.has(id)) {
          const f = page.commonObjs.get(id) as { name?: string } | null;
          if (f?.name) name = cleanFontName(f.name);
        }
      } catch {
        /* font not resolved; keep the internal id */
      }
      fontNames.set(id, name);
    }
    return name;
  };

  const runs: Run[] = [];
  for (const raw of content.items as TextItemLike[]) {
    if (!("str" in raw) || !raw.str || !raw.str.trim()) continue;
    const m = mul(vt, raw.transform);
    const size = Math.hypot(m[2], m[3]);
    if (size < 0.5) continue;
    const font = fontFor(raw.fontName);
    const { bold, italic } = fontStyle(font);
    runs.push({
      str: raw.str,
      x: m[4],
      y: m[5],
      w: raw.width,
      size,
      font,
      bold,
      italic,
      rotated: Math.abs(m[1]) > 0.05 * size || m[0] <= 0,
    });
  }

  const graphics = collectGraphics(ops.fnArray, ops.argsArray, vt, pdfjs.OPS, viewport.width, viewport.height);
  page.cleanup();
  return { index, w: viewport.width, h: viewport.height, runs, graphics };
}

function isWhite(color: unknown): boolean {
  if (typeof color === "string") return /^#?f{6}$/i.test(color);
  if (Array.isArray(color)) return color.every((c) => (typeof c === "number" ? c >= 0.98 || c >= 250 : false));
  return false;
}

function collectGraphics(
  fnArray: number[],
  argsArray: unknown[][],
  vt: Matrix,
  OPS: Record<string, number>,
  pageW: number,
  pageH: number,
): Graphic[] {
  const out: Graphic[] = [];
  type State = { ctm: Matrix; fill: unknown; clip: Rect | null; fillAlpha: number; strokeAlpha: number };
  const stack: State[] = [];
  let fillAlpha = 1;
  let strokeAlpha = 1;
  const save = () => stack.push({ ctm, fill, clip, fillAlpha, strokeAlpha });
  const restore = () => {
    const s = stack.pop();
    if (s) ({ ctm, fill, clip, fillAlpha, strokeAlpha } = s);
  };
  const intersect = (a: Rect | null, b: Rect): Rect => {
    if (!a) return b;
    const r = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
    return r.x1 > r.x0 && r.y1 > r.y0 ? r : b;
  };
  let ctm: Matrix = IDENTITY;
  let fill: unknown = "#000000";
  // Gradients are painted inside a clipping path; remember the last path and
  // the active clip so a shading fill can be located.
  let lastPath: Rect | null = null;
  let clip: Rect | null = null;
  let pendingClip = false;
  const fillOps = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  const strokeOps = new Set([OPS.stroke, OPS.closeStroke]);
  const imageOps = new Set([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintSolidColorImageMask,
  ]);

  const push = (kind: Graphic["kind"], r: Rect) => {
    const d = bboxOf(vt, r.x0, r.y0, r.x1, r.y1);
    const clipped = {
      x0: Math.max(0, d.x0),
      y0: Math.max(0, d.y0),
      x1: Math.min(pageW, d.x1),
      y1: Math.min(pageH, d.y1),
    };
    const w = clipped.x1 - clipped.x0;
    const h = clipped.y1 - clipped.y0;
    if (w < -0.1 || h < -0.1 || (w < 0.5 && h < 0.5)) return;
    out.push({ kind, ...clipped });
  };

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];
    if (fn === OPS.save) {
      save();
    } else if (fn === OPS.restore) {
      restore();
    } else if (fn === OPS.setGState) {
      for (const [k, v] of (args?.[0] as [string, unknown][]) ?? []) {
        if (k === "ca" && typeof v === "number") fillAlpha = v;
        if (k === "CA" && typeof v === "number") strokeAlpha = v;
      }
    } else if (fn === OPS.transform) {
      ctm = mul(ctm, args as number[]);
    } else if (fn === OPS.paintFormXObjectBegin) {
      save();
      const matrix = args?.[0] as number[] | null;
      if (matrix && matrix.length === 6) ctm = mul(ctm, matrix);
      // The form's bounding box clips everything drawn inside it.
      const bbox = args?.[1] as ArrayLike<number> | null;
      if (bbox && bbox.length === 4) clip = intersect(clip, bboxOf(ctm, bbox[0], bbox[1], bbox[2], bbox[3]));
    } else if (fn === OPS.beginGroup) {
      const group = args?.[0] as { bbox?: ArrayLike<number>; matrix?: number[] } | undefined;
      save();
      if (group?.matrix && group.matrix.length === 6) ctm = mul(ctm, group.matrix);
      if (group?.bbox && group.bbox.length === 4) clip = intersect(clip, bboxOf(ctm, group.bbox[0], group.bbox[1], group.bbox[2], group.bbox[3]));
    } else if (fn === OPS.endGroup) {
      restore();
    } else if (fn === OPS.paintFormXObjectEnd) {
      restore();
    } else if (fn === OPS.clip || fn === OPS.eoClip) {
      // pdf.js may emit the clip before or after the path it applies to.
      pendingClip = true;
    } else if (fn === OPS.shadingFill) {
      if (clip) push("path", clip);
    } else if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray || fn === OPS.setFillColorN) {
      fill = args?.[0] ?? args;
    } else if (fn === OPS.constructPath) {
      const paint = args?.[0] as number;
      const minMax = args?.[2] as ArrayLike<number> | null;
      if (!minMax || minMax.length < 4) continue;
      if (Number.isFinite(minMax[0]) && Number.isFinite(minMax[3])) {
        lastPath = bboxOf(ctm, minMax[0], minMax[1], minMax[2], minMax[3]);
        if (pendingClip || paint === OPS.endPath) {
          clip = intersect(clip, lastPath);
          pendingClip = false;
        }
      }
      const isFill = fillOps.has(paint);
      const isStroke = strokeOps.has(paint);
      if (!isFill && !isStroke) continue; // clipping or invisible path
      if (isFill && !isStroke && (isWhite(fill) || fillAlpha === 0)) continue;
      if (isStroke && !isFill && strokeAlpha === 0) continue;
      if (isFill && isStroke && fillAlpha === 0 && strokeAlpha === 0) continue;
      const [x0, y0, x1, y1] = [minMax[0], minMax[1], minMax[2], minMax[3]];
      if (!Number.isFinite(x0) || !Number.isFinite(y1)) continue;
      push("path", { ...bboxOf(ctm, x0, y0, x1, y1) });
    } else if (imageOps.has(fn)) {
      push("image", bboxOf(ctm, 0, 0, 1, 1));
    }
  }
  return out;
}
