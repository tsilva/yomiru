import QRCode from "qrcode";
import { codePattern } from "./feedback-links.mjs";
import { publicOrigin } from "./library.mjs";

// ASS has no interactive links. Encode the same real HTTPS destination as QR and text.
export function addFeedbackCue(bytes, code) {
  if (!codePattern.test(code)) throw new Error("Invalid feedback code");
  const source = bytes.toString("utf8");
  if (source.includes("YomiruFeedbackV1")) throw new Error("Feedback cue already present");
  const width = Number(source.match(/^PlayResX:\s*(\d+)/m)?.[1]);
  const height = Number(source.match(/^PlayResY:\s*(\d+)/m)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240 || width > 7680 || height > 4320) throw new Error("Unsupported ASS canvas");
  const styles = source.match(/\[V4\+ Styles\][\s\S]*?^Format:\s*([^\r\n]+)/m)?.[1].split(/,\s*/);
  const events = source.match(/\[Events\][\s\S]*?^Format:\s*([^\r\n]+)/m)?.[1].split(/,\s*/);
  const styleFields = "Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding".split(",");
  const eventFields = "Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text".split(",");
  if (!styles || !events || styleFields.some(k => !styles.includes(k))
    || eventFields.some(k => !events.includes(k)) || events.at(-1) !== "Text") throw new Error("Unsupported ASS format");
  const scale = height / 1080, n = value => Math.round(value * scale);
  // Keep clear of bottom dialogue if a future episode starts speaking immediately.
  const earlyDialogue = source.split(/\r?\n/).some(line => {
    if (!line.startsWith("Dialogue:")) return false;
    const parts = line.slice(9).trimStart().split(",");
    const time = parts[events.indexOf("Start")];
    const match = time?.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
    return match && Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) < 3;
  });
  const x = n(24), y = earlyDialogue ? n(50) : height - n(390);
  const w = n(740), h = n(260), qr = QRCode.create(`${publicOrigin}/f/${code}`, { errorCorrectionLevel: "M" });
  const module = Math.max(1, Math.floor(n(210) / (qr.modules.size + 8)));
  const qs = (qr.modules.size + 8) * module, qx = x + w - qs - n(24), qy = y + Math.round((h - qs) / 2);
  const values = { Name: "YomiruFeedbackV1", Fontname: "Arial", Fontsize: n(32), PrimaryColour: "&H00FFFFFF", SecondaryColour: "&H00FFFFFF",
    OutlineColour: "&H00000000", BackColour: "&H00000000", Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
    ScaleX: 100, ScaleY: 100, Spacing: 0, Angle: 0, BorderStyle: 1, Outline: 0, Shadow: 0, Alignment: 7,
    MarginL: 0, MarginR: 0, MarginV: 0, Encoding: 1 };
  const style = `Style: ${styles.map(k => values[k] ?? 0).join(",")}\n`;
  const lines = [];
  const event = (layer, text) => {
    const fields = { Layer: layer, Start: "0:00:00.00", End: "0:00:03.00", Style: values.Name,
      Name: "", MarginL: 0, MarginR: 0, MarginV: 0, Effect: "", Text: text };
    lines.push(`Dialogue: ${events.map(k => fields[k] ?? "").join(",")}`);
  };
  const rect = (px, py, rw, rh) => `m ${px} ${py} l ${px+rw} ${py} ${px+rw} ${py+rh} ${px} ${py+rh} `;
  const draw = (layer, color, alpha, path, border = 0) => event(layer,
    `{\\an7\\pos(0,0)\\p1\\bord${border}\\shad0\\1c&H${color}&\\1a&H${alpha}&\\3c&HD976BB&}${path}{\\p0}`);
  const r = n(18);
  const rounded = `m ${x+r} ${y} l ${x+w-r} ${y} b ${x+w} ${y} ${x+w} ${y} ${x+w} ${y+r} l ${x+w} ${y+h-r} b ${x+w} ${y+h} ${x+w} ${y+h} ${x+w-r} ${y+h} l ${x+r} ${y+h} b ${x} ${y+h} ${x} ${y+h} ${x} ${y+h-r} l ${x} ${y+r} b ${x} ${y} ${x} ${y} ${x+r} ${y}`;
  draw(100, "201C24", "30", rounded, n(2));
  const fox = points => points.map((p,i) => `${i ? "l" : "m"} ${x+n(24+p[0])} ${y+n(18+p[1])}`).join(" ");
  draw(103, "238EF6", "00", fox([[0,0],[16,9],[30,9],[46,0],[43,30],[23,45],[3,30]]));
  draw(104, "FFFFFF", "00", fox([[3,23],[19,28],[23,38],[27,28],[43,23],[40,34],[23,45],[6,34]]));
  draw(105, "201C24", "00", fox([[19,33],[27,33],[23,38]]));
  draw(101, "FFFFFF", "00", rect(qx, qy, qs, qs));
  let pixels = "";
  for (let row = 0; row < qr.modules.size; row++) for (let col = 0; col < qr.modules.size;) {
    if (!qr.modules.get(row, col)) { col++; continue; }
    const start = col++;
    while (col < qr.modules.size && qr.modules.get(row, col)) col++;
    pixels += rect(qx + (start + 4) * module, qy + (row + 4) * module, (col - start) * module, module);
  }
  draw(102, "000000", "00", pixels);
  const text = (offset, size, content, bold = false) => event(103,
    `{\\an7\\pos(${x+n(24)},${y+n(offset)})\\fs${n(size)}\\b${bold?1:0}\\q2}${content}`);
  event(106, `{\\an7\\pos(${x+n(86)},${y+n(18)})\\fs${n(40)}\\b1\\q2}Yomiru`);
  text(88, 32, "Please leave your feedback");
  text(136, 27, "Scan or go to link for feedback");
  text(183, 26, `yomiru.tsilva.eu/f/${code}`);
  // Insert into each existing section without rewriting a single original event.
  return Buffer.from(source.replace(/(\[Events\])/, `${style}\n$1`).trimEnd() + "\n" + lines.join("\n") + "\n");
}
