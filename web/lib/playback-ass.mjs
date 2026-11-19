function positionDialogue(source, styleSection, styles, events, width, height) {
  const margins = ["MarginL", "MarginR", "MarginV"];
  const styleMargins = margins.map(field => styles.indexOf(field));
  const eventMargins = margins.map(field => events.indexOf(field));
  const nameIndex = styles.indexOf("Name"), alignmentIndex = styles.indexOf("Alignment");
  const positions = new Map();
  for (const [, row] of styleSection.matchAll(/^Style:[ \t]*([^\r\n]+)/gm)) {
    const fields = row.split(",");
    const name = fields[nameIndex]?.trim();
    const alignment = fields[alignmentIndex]?.trim();
    if ((name === "Japanese" && alignment === "2") || (name === "English" && alignment === "8")) {
      positions.set(name, styleMargins.map(index => Number(fields[index])));
    }
  }

  // Media3 honors explicit positions but falls back to screen edges for style margins.
  const styleIndex = events.indexOf("Style"), effectIndex = events.indexOf("Effect");
  const textIndex = events.indexOf("Text");
  return source.replace(/^Dialogue:([^\r\n]*)/gm, (line, row) => {
    const fields = row.split(",");
    const name = fields[styleIndex]?.trim();
    const defaults = positions.get(name);
    if (!defaults || fields[textIndex] === undefined || fields[effectIndex].trim()) return line;
    if (/{[^}]*\\(?:pos\s*\(|move\s*\(|an?\d|r)/i.test(fields.slice(textIndex).join(","))) return line;

    const [left, right, vertical] = eventMargins.map((index, i) => Number(fields[index]) || defaults[i]);
    const x = (width + left - right) / 2;
    const y = name === "Japanese" ? height - vertical : vertical;
    if (!(x >= 0 && x <= width && y >= 0 && y <= height)) return line;
    fields[textIndex] = `{\\pos(${x},${y})}${fields[textIndex]}`;
    return `Dialogue:${fields.join(",")}`;
  });
}

export function renderPlaybackTrack(bytes) {
  const source = bytes.toString("utf8");
  if (/\bYomiruFeedbackV\d+\b/.test(source)) throw new Error("Feedback cue already present");
  const width = Number(source.match(/^PlayResX:\s*(\d+)/m)?.[1]);
  const height = Number(source.match(/^PlayResY:\s*(\d+)/m)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 320 || height < 240 || width > 7680 || height > 4320) throw new Error("Unsupported ASS canvas");
  const styleSection = source.split("[V4+ Styles]")[1]?.split(/^\[/m, 1)[0];
  const styles = styleSection?.match(/^Format:\s*([^\r\n]+)/m)?.[1].split(/,\s*/);
  const events = source.match(/\[Events\][\s\S]*?^Format:\s*([^\r\n]+)/m)?.[1].split(/,\s*/);
  const styleFields = "Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding".split(",");
  const eventFields = "Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text".split(",");
  if (!styles || !events || styleFields.some(k => !styles.includes(k))
    || eventFields.some(k => !events.includes(k)) || events.at(-1) !== "Text") throw new Error("Unsupported ASS format");
  return Buffer.from(positionDialogue(source, styleSection, styles, events, width, height));
}
