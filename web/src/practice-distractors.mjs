export const colorHues = Object.fromEntries(Object.entries({
  black: ["black", "jet black", "pitch-black"],
  white: ["white", "snow white"],
  gray: ["gray", "grey"],
  red: ["red", "scarlet", "crimson", "vermilion"],
  pink: ["pink", "rose pink"],
  orange: ["orange"],
  yellow: ["yellow"],
  green: ["green", "dark green", "light green"],
  blue: ["blue", "navy blue", "dark blue", "deep blue", "light blue", "sky blue", "azure", "cyan", "indigo"],
  purple: ["purple", "violet"],
  brown: ["brown", "dark brown", "light brown", "beige"],
}).flatMap(([hue, names]) => names.flatMap(name =>
  [name, `${name} color`, `${name} colour`, `${name} (color)`, `${name} (colour)`].map(key => [key, hue]))));

export function colorHue(meaningKey) {
  return Object.hasOwn(colorHues, meaningKey) ? colorHues[meaningKey] : undefined;
}
