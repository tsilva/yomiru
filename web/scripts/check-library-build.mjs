import { readdir } from "node:fs/promises";

try {
  if ((await readdir(new URL("../public/library/", import.meta.url))).length) {
    throw new Error("Remove the generated public/library snapshot from the build; subtitles live in object storage");
  }
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
