import { Problem } from './shared';

export const defaultCaption = '自己的素材，也能焕新表达\n十五秒，呈现商品亮点';

// This experiment uses the generated Noto SC common-CJK font, not arbitrary fonts.
// Reserve a full 42px cell even for Latin glyphs (W/@ can be almost full-width).
// Fifteen cells leave room for outlines and margins; no approximate Latin half-width.
export function captionText(value: unknown = defaultCaption): string {
  if (typeof value !== 'string') throw new Problem(400, 'Caption must be text');
  const text = value.replace(/\r\n/g, '\n').trim();
  const lines = text.split('\n');
  if (!text || lines.length > 2 || lines.some(line => !line.trim())) throw new Problem(400, 'Caption must contain one or two non-empty lines');
  for (const line of lines) {
    let width = 0;
    for (const character of line) {
      const code = character.codePointAt(0)!;
      if (!(code >= 0x20 && code <= 0x7e || code >= 0xa0 && code <= 0xff || code >= 0x2000 && code <= 0x206f || code >= 0x3000 && code <= 0x303f || code >= 0x4e00 && code <= 0x9fff || code >= 0xff00 && code <= 0xffef)) throw new Problem(422, 'Caption contains unsupported characters');
      // Reject invisible directional/formatting controls even if inside punctuation ranges.
      if (code >= 0x200b && code <= 0x200f || code >= 0x2028 && code <= 0x202f || code >= 0x2060 && code <= 0x206f) throw new Problem(422, 'Caption contains unsupported formatting controls');
      width += 2;
    }
    if (width > 30) throw new Problem(422, 'Caption line is too wide for the fixed style; use up to 15 characters');
  }
  return text;
}

export function clipStart(value: unknown = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 55) throw new Problem(400, 'Clip start must be between 0 and 55 seconds');
  return value;
}
