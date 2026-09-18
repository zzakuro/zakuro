import express from "express";
import { createCommunityStore } from "./communityStore";
import { GameComment } from "../src/types";

// ── Community layer: comments + ratings (game experiences) ───────────────────
// Persistence is delegated to the CommunityStore interface (JSON files by
// default). Identity is minimal: a comment/rating belongs to an authorKey
// ("u:<username>" or "v:<visitorId>") so logged-out guests can still
// participate, mirroring UnionCrax guest sessions.

const store = createCommunityStore();

function sanitizeAuthorKey(key: string): string {
  const clean = (key || "").toString().slice(0, 128);
  return /^u:|^v:/.test(clean) ? clean : `v:${clean || "anon"}`;
}

function sanitizeAuthor(author: string, key: string): string {
  const clean = (author || "").toString().slice(0, 64).trim();
  if (clean) return clean;
  return key.startsWith("u:") ? key.slice(2) : "Guest";
}

function ratingSummary(gameId: string) {
  const ratings = store.listRatings(gameId);
  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  const platforms: Record<string, number> = {};
  for (const r of ratings) {
    distribution[r.value] = (distribution[r.value] || 0) + 1;
    sum += r.value;
    if (r.platform) platforms[r.platform] = (platforms[r.platform] || 0) + 1;
  }
  const count = ratings.length;
  return {
    count,
    average: count ? Math.round((sum / count) * 10) / 10 : 0,
    distribution,
    platforms,
  };
}

export function communityRouter() {
  const router = express.Router();

  // ── Comments ────────────────────────────────────────────────────────────────

  router.get("/games/:id/comments", (req, res) => {
    const { id } = req.params;
    const comments = store
      .listComments(id)
      .sort((a, b) => Number(b.pinned ? 1 : 0) - Number(a.pinned ? 1 : 0) || b.createdAt.localeCompare(a.createdAt));
    res.json(comments);
  });

  router.post("/games/:id/comments", (req, res) => {
    const { id } = req.params;
    const { text, parentId } = req.body ?? {};
    if (!text || !text.toString().trim()) {
      return res.status(400).json({ error: "Comment text is required." });
    }
    const authorKey = sanitizeAuthorKey(req.body?.authorKey);
    const comment: GameComment = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      gameId: id,
      authorKey,
      author: sanitizeAuthor(req.body?.author, authorKey),
      text: text.toString().slice(0, 2000),
      likes: [],
      reported: false,
      parentId: parentId ? parentId.toString() : undefined,
      createdAt: new Date().toISOString(),
    };
    store.addComment(comment);
    store.saveComments();
    res.status(201).json(comment);
  });

  router.delete("/games/:id/comments/:commentId", (req, res) => {
    const comment = store.getComment(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found." });
    const authorKey = (req.query.authorKey as string) ?? req.body?.authorKey;
    if (comment.authorKey !== sanitizeAuthorKey(authorKey)) {
      return res.status(403).json({ error: "You can only delete your own comments." });
    }
    store.removeComment(comment);
    store.saveComments();
    res.json({ success: true });
  });

  router.post("/games/:id/comments/:commentId/like", (req, res) => {
    const comment = store.getComment(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found." });
    const key = sanitizeAuthorKey(req.body?.authorKey);
    const i = comment.likes.indexOf(key);
    const desired = typeof req.body?.liked === "boolean" ? req.body.liked : undefined;
    const liked = desired === undefined ? i < 0 : desired;
    if (liked && i < 0) comment.likes.push(key);
    else if (!liked && i >= 0) comment.likes.splice(i, 1);
    store.saveComments();
    res.json({ likes: comment.likes.length, liked });
  });

  router.post("/games/:id/comments/:commentId/report", (req, res) => {
    const comment = store.getComment(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found." });
    comment.reported = true;
    store.saveComments();
    res.json({ success: true });
  });

  // ── Ratings (experiences) ───────────────────────────────────────────────────

  router.get("/games/:id/ratings", (req, res) => {
    const mine = req.query.authorKey
      ? store.findRating(req.params.id, sanitizeAuthorKey(req.query.authorKey as string))
      : undefined;
    res.json({ ...ratingSummary(req.params.id), mine: mine ? { value: mine.value, platform: mine.platform } : null });
  });

  router.post("/games/:id/ratings", (req, res) => {
    const { id } = req.params;
    const value = Number(req.body?.value);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      return res.status(400).json({ error: "Rating value must be an integer 1-5." });
    }
    const authorKey = sanitizeAuthorKey(req.body?.authorKey);
    const platform = (req.body?.platform || "").toString().slice(0, 32) || undefined;
    const existing = store.findRating(id, authorKey);
    const now = new Date().toISOString();

    if (existing) {
      existing.value = value;
      existing.platform = platform;
      existing.updatedAt = now;
    } else {
      store.addRating({
        id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        gameId: id,
        authorKey,
        value,
        platform,
        createdAt: now,
      });
    }
    store.saveRatings();
    res.json(ratingSummary(id));
  });

  return router;
}