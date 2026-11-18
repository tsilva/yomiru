import { createHash } from "node:crypto";
import { privateBlobIO } from "./compatibility-storage.mjs";
import { maxStateBytes } from "./compatibility.mjs";
import { database } from "./database.mjs";
import { databaseEnabled } from "./storage-config.mjs";

export const maxCommentLength = 1000;
const maxRatings = 5000;
const ratingKey = (code, voter) => createHash("sha256").update(JSON.stringify([code, voter])).digest("hex");

export function validRating({ stars, comment }) {
  return Number.isInteger(stars) && stars >= 1 && stars <= 5
    && typeof comment === "string" && comment.length <= maxCommentLength && !comment.includes("\0");
}

export function createBlobRatings(io) {
  const path = code => `feedback-ratings/v1/${code}.json`;
  return {
    async get(code, voter) {
      const record = await io.read(path(code));
      return record?.state.ratings[ratingKey(code, voter)] ?? null;
    },
    async save(code, voter, rating) {
      const key = ratingKey(code, voter);
      for (let attempt = 0; attempt < 4; attempt++) {
        const record = await io.read(path(code));
        const ratings = record?.state.ratings ?? {};
        if (ratings[key]?.stars === rating.stars && ratings[key].comment === rating.comment) return;
        if (!ratings[key] && Object.keys(ratings).length >= maxRatings) throw new Error("Rating capacity reached");
        const state = { ratings: { ...ratings, [key]: rating } };
        if (Buffer.byteLength(JSON.stringify(state)) > maxStateBytes) throw new Error("Rating capacity reached");
        if (await io.write(path(code), state, record?.etag ?? null)) return;
      }
      throw new Error("Rating was updated concurrently");
    },
  };
}

export function createDatabaseRatings(sql) {
  return {
    async get(code, voter) {
      const [rating] = await sql`SELECT stars, comment FROM yomiru_subtitle_rating
        WHERE code = ${code} AND voter = ${ratingKey(code, voter)}`;
      return rating ?? null;
    },
    async save(code, voter, { stars, comment }) {
      const key = ratingKey(code, voter);
      return sql.begin(async tx => {
        await tx`SELECT code FROM yomiru_feedback_link WHERE code = ${code} FOR UPDATE`;
        const [existing] = await tx`SELECT 1 FROM yomiru_subtitle_rating WHERE code = ${code} AND voter = ${key}`;
        if (!existing) {
          const [{ count }] = await tx`SELECT count(*)::int AS count FROM yomiru_subtitle_rating WHERE code = ${code}`;
          if (count >= maxRatings) throw new Error("Rating capacity reached");
        }
        await tx`INSERT INTO yomiru_subtitle_rating (code, voter, stars, comment)
          VALUES (${code}, ${key}, ${stars}, ${comment})
          ON CONFLICT (code, voter) DO UPDATE SET stars = EXCLUDED.stars, comment = EXCLUDED.comment`;
      });
    },
  };
}

const legacy = createBlobRatings(privateBlobIO);
const active = () => databaseEnabled() ? createDatabaseRatings(database()) : legacy;
export const subtitleRatings = {
  get: (...args) => active().get(...args),
  save: (...args) => {
    if (process.env.YOMIRU_PAUSE_FEEDBACK === "1") throw new Error("Feedback temporarily read-only");
    return active().save(...args);
  },
};
